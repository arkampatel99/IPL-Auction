// Friends rooms. The host's browser runs the auction; guests send their actions to it.
// Two routes, both free and without accounts:
//  1. Direct (WebRTC via PeerJS): fastest, works on most Wi-Fi.
//  2. Backup relay (public MQTT broker over WebSocket, see relay.ts): works on mobile data and strict
//     networks where phones can't reach each other directly. The host listens on both; a guest
//     switches to the relay if the direct route doesn't open within a few seconds.

import Peer, { type DataConnection } from 'peerjs';
import { openRelay, orderedSender, packSync, unpack, type Relay } from './relay';
import type { TeamId } from '../data/teams';
import type { GameState, Settings } from '../game/engine';

const PREFIX = 'iplauctionroom-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I

/**
 * How browsers find a path to each other. STUN works on most home Wi-Fi. Phones on mobile data often
 * need a TURN relay: set VITE_TURN_CREDENTIALS_URL (a Metered free-plan credentials URL, which returns
 * an iceServers list) or VITE_TURN_URL + VITE_TURN_USERNAME + VITE_TURN_CREDENTIAL at build time.
 */
const STUN: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
let ice: Promise<RTCIceServer[]> | null = null;
function iceServers(): Promise<RTCIceServer[]> {
  if (ice) return ice;
  const env = import.meta.env;
  ice = (async () => {
    if (env.VITE_TURN_CREDENTIALS_URL) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(env.VITE_TURN_CREDENTIALS_URL, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) { const list = await res.json() as RTCIceServer[]; if (Array.isArray(list) && list.length) return [...STUN, ...list]; }
      } catch { /* fall back to STUN only */ }
    }
    if (env.VITE_TURN_URL) {
      return [...STUN, { urls: String(env.VITE_TURN_URL).split(',').map((u: string) => u.trim()), username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL }];
    }
    return STUN;
  })();
  return ice;
}

/** Phones pause background tabs, which drops the link to the PeerJS server. Get it back. */
function keepAlive(peer: Peer) {
  const again = () => { if (!peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch { /* try next time */ } } };
  peer.on('disconnected', () => setTimeout(again, 800));
  const onShow = () => { if (document.visibilityState === 'visible') again(); };
  document.addEventListener('visibilitychange', onShow);
  window.addEventListener('online', again);
  peer.on('close', () => { document.removeEventListener('visibilitychange', onShow); window.removeEventListener('online', again); });
}

export const newCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const inviteLink = (code: string) => `${window.location.origin}/r/${code}`;

export interface Seat {
  name: string;
  peer: string | 'host';
  /** This device, so a returning friend gets their seat back. */
  cid?: string;
  /** Set while the friend is unreachable (phone locked, app switched). The seat is kept for a while. */
  away?: number;
}

/** How long an unreachable friend keeps their seat before a bot (or someone else) takes the team. */
export const AWAY_KEEP_MS = 60000;

/** A random id kept on this device, so the host can recognise a friend who reconnects. */
function deviceId(): string {
  const KEY = 'ipl-auction-cid';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem(KEY, id); }
    return id;
  } catch { return ''; }
}
export interface Lobby {
  code: string;
  host: string;
  settings: Omit<Settings, 'team' | 'seed' | 'humans'>;
  seats: Partial<Record<TeamId, Seat>>;
  started: boolean;
  /** Goes up by one each time someone else takes over hosting, so everyone follows the newest host. */
  epoch?: number;
}

/** Guest → host */
export type GuestMsg =
  | { t: 'hello'; name: string; cid?: string }
  | { t: 'ping' }
  | { t: 'squad'; ids: string[] }
  | { t: 'pick'; team: TeamId }
  | { t: 'bid' }
  | { t: 'rtm'; yes: boolean }
  | { t: 'raise'; amount: number | null };

/** Host → guest */
export type HostMsg =
  | { t: 'lobby'; lobby: Lobby }
  | { t: 'state'; state: GameState; now: number }
  | { t: 'error'; text: string }
  | { t: 'pong' }
  /** The host is closing the page: someone else should take over now. */
  | { t: 'bye' };

type Listener = () => void;

// ---------------- host ----------------

/** One connected guest, over either route. */
interface Link { peer: string; label: string; cid?: string; via: 'direct' | 'relay'; send(msg: HostMsg): void; close(): void }

export interface HostRoom {
  lobby: Lobby;
  peers: Map<string, Link>;
  onAction?: (team: TeamId, msg: GuestMsg) => void;
  /** A friend took a bot's team during the auction. Returns false if that isn't possible now. */
  onJoin?: (team: TeamId, name: string) => boolean;
  /** A friend left during the auction: a bot takes their team back. */
  onLeave?: (team: TeamId) => void;
  listeners: Set<Listener>;
  sendLobby(): void;
  sendState(state: GameState): void;
  close(): void;
}

let host: HostRoom | null = null;
export const hostRoom = () => host;

const topicOf = (code: string, to: 'host' | 'guests') => `iplauctionroom/v1/${code.toUpperCase()}/${to}`;
const RELAY_STATE_MS = 400;

export function createRoom(name: string, team: TeamId, settings: Lobby['settings']): Promise<HostRoom> {
  const code = newCode();
  return openHost(code, { code, host: name, settings, seats: { [team]: { name, peer: 'host', cid: deviceId() } }, started: false, epoch: 0 }, false);
}

/** A friend takes over hosting a running room (the host left): same code, the friend's latest copy of the lobby. */
export function resumeRoom(lobby: Lobby): Promise<HostRoom> {
  return openHost(lobby.code, lobby, true);
}

async function openHost(code: string, lobby: Lobby, resuming: boolean): Promise<HostRoom> {
  const iceList = await iceServers();
  const relay = openRelay();
  const send = orderedSender(relay, topicOf(code, 'guests'));
  // Every host message carries the host number and this device's id, so guests follow only the newest host
  // (and, if two friends took over at once, the same one of the two).
  const myHid = deviceId() || Math.random().toString(36).slice(2, 12);
  const toGuests = (v: { to?: string; msg: HostMsg }) => send({ ...v, e: room.lobby.epoch ?? 0, h: myHid });
  const relayCount = () => [...room.peers.values()].filter(l => l.via === 'relay').length;

  // Game state over the relay: at most every 400 ms, always the latest.
  let relayTimer = 0, relayLast = 0, relayPending: HostMsg | null = null;
  const relayState = (msg: HostMsg) => {
    relayPending = msg;
    if (relayTimer) return;
    const go = () => { relayTimer = 0; relayLast = Date.now(); if (relayPending) toGuests({ msg: relayPending }); relayPending = null; };
    const wait = RELAY_STATE_MS - (Date.now() - relayLast);
    if (wait <= 0) go(); else relayTimer = window.setTimeout(go, wait);
  };

  const room: HostRoom = {
    lobby,
    peers: new Map(),
    listeners: new Set(),
    sendLobby() {
      const msg: HostMsg = { t: 'lobby', lobby: room.lobby };
      room.peers.forEach(l => { if (l.via === 'direct') l.send(msg); });
      if (relayCount()) toGuests({ msg });
      room.listeners.forEach(f => f());
    },
    sendState(state) {
      const msg: HostMsg = { t: 'state', state, now: Date.now() };
      room.peers.forEach(l => { if (l.via === 'direct') l.send(msg); });
      if (relayCount()) relayState(msg);
    },
    close() {
      closed = true;
      clearInterval(sweep); clearTimeout(relayTimer); clearTimeout(claimTimer);
      window.removeEventListener('pagehide', bye);
      peer?.destroy(); relay.close();
      if (host === room) host = null;
    },
  };
  let closed = false;
  let peer: Peer | null = null;
  let claimTimer = 0;

  // Closing the page: tell everyone at once, so a friend takes over hosting straight away.
  const bye = () => {
    if (closed) return;
    room.peers.forEach(l => { if (l.via === 'direct') l.send({ t: 'bye' }); });
    relay.publish(topicOf(code, 'guests'), packSync({ msg: { t: 'bye' }, e: room.lobby.epoch ?? 0, h: myHid }));
  };
  window.addEventListener('pagehide', bye);

  // A closed tab can take a minute to show up as a closed connection, so guests ping every 3 s
  // and anyone silent for 12 s counts as gone (a bot takes their team back).
  const seen = new Map<string, number>();
  const sweep = window.setInterval(() => {
    const now = Date.now();
    seen.forEach((at, id) => { if (now - at > 12000) { const l = room.peers.get(id); if (l) drop(l); else seen.delete(id); } });
    // Friends away too long lose the seat: a bot plays on (auction) or the team is free again (lobby).
    let changed = false;
    for (const [t, st] of Object.entries(room.lobby.seats) as [TeamId, Seat][]) {
      if (!st.away || now - st.away < AWAY_KEEP_MS) continue;
      delete room.lobby.seats[t];
      if (room.lobby.started) room.onLeave?.(t);
      changed = true;
    }
    if (changed) room.sendLobby();
  }, 3000);

  const drop = (link: Link) => {
    if (room.peers.get(link.peer) !== link) return;
    room.peers.delete(link.peer);
    seen.delete(link.peer);
    link.close();
    // Keep their seat for now, marked away: phones drop out whenever the screen locks.
    for (const st of Object.values(room.lobby.seats) as Seat[]) if (st.peer === link.peer) st.away = Date.now();
    room.sendLobby();
  };

  const add = (link: Link) => {
    const old = room.peers.get(link.peer);
    if (old && old !== link) old.close();
    room.peers.set(link.peer, link);
    seen.set(link.peer, Date.now());
    link.send({ t: 'lobby', lobby: room.lobby });
  };

  const receive = (link: Link, msg: GuestMsg) => {
    seen.set(link.peer, Date.now());
    // Heard from someone marked away: they're back.
    for (const st of Object.values(room.lobby.seats) as Seat[]) {
      if (st.peer === link.peer && st.away) { delete st.away; room.sendLobby(); }
    }
    if (msg.t === 'ping') { link.send({ t: 'pong' }); return; }
    if (msg.t === 'hello') {
      link.label = String(msg.name ?? '').slice(0, 20);
      if (typeof msg.cid === 'string' && msg.cid) link.cid = msg.cid.slice(0, 24);
      // Back on this device: give the seat straight back (no need to tap anything).
      const back = link.cid ? (Object.entries(room.lobby.seats) as [TeamId, Seat][]).find(([, st]) => st.peer !== 'host' && st.cid === link.cid && st.peer !== link.peer) : undefined;
      if (back && !(Object.values(room.lobby.seats) as Seat[]).some(st => st.peer === link.peer)) {
        const [t, st] = back;
        const old = room.peers.get(st.peer);
        if (old) { room.peers.delete(st.peer); seen.delete(st.peer); old.close(); }
        room.lobby.seats[t] = { name: link.label || st.name, peer: link.peer, cid: link.cid };
        room.sendLobby();
        return;
      }
      link.send({ t: 'lobby', lobby: room.lobby });
      return;
    }
    const seat = (Object.entries(room.lobby.seats) as [TeamId, Seat][]).find(([, s]) => s.peer === link.peer);
    if (msg.t === 'pick') {
      if (seat && seat[0] === msg.team) { room.sendLobby(); return; }
      const who = link.label || 'Friend';
      const holder = room.lobby.seats[msg.team];
      if (holder) {
        // The same device coming back on a new connection: hand the seat over. (Matched by device only,
        // so two friends with the same name can't take each other's seats.)
        const sameDevice = Boolean(link.cid && holder.cid === link.cid);
        if (holder.peer !== 'host' && !seat && sameDevice) {
          const old = room.peers.get(holder.peer);
          if (old) { room.peers.delete(holder.peer); seen.delete(holder.peer); old.close(); }
          room.lobby.seats[msg.team] = { name: who, peer: link.peer, cid: link.cid };
          room.sendLobby();
          return;
        }
        link.send({ t: 'error', text: 'That team was just taken. Pick another.' });
        return;
      }
      if (room.lobby.started) {
        // Joining late: take over a bot's team. Only one team per person once the auction runs.
        if (seat) { link.send({ t: 'error', text: 'You already have a team in this auction.' }); return; }
        if (!room.onJoin?.(msg.team, who)) { link.send({ t: 'error', text: 'You can join once the host is back on the auction screen.' }); return; }
      } else if (seat) delete room.lobby.seats[seat[0]];
      room.lobby.seats[msg.team] = { name: who, peer: link.peer, cid: link.cid };
      room.sendLobby();
      return;
    }
    if (seat) room.onAction?.(seat[0], msg);
  };

  // Route 1: direct connections. A new host may have to wait for the old host's id to be released.
  const directReady = new Promise<void>((resolve, reject) => {
    let first = true;
    const claim = () => {
      if (closed) return;
      const p = new Peer(PREFIX + code, { config: { iceServers: iceList } });
      peer = p;
      keepAlive(p);
      p.on('open', () => { if (first) { first = false; resolve(); } });
      p.on('error', err => {
        if (p.open) return;
        p.destroy();
        if (first && !resuming) { first = false; reject(err); return; }
        if (String(err.type) === 'unavailable-id' || resuming) claimTimer = window.setTimeout(claim, 15000);
      });
      p.on('connection', onConnection);
    };
    claim();
  });

  function onConnection(conn: DataConnection) {
    const link: Link = {
      peer: conn.peer, label: '', via: 'direct',
      send: m => { if (conn.open) conn.send(m); },
      close: () => conn.close(),
    };
    conn.on('open', () => add(link));
    conn.on('data', raw => receive(link, raw as GuestMsg));
    conn.on('close', () => drop(link));
  }

  // Another friend took over hosting (we were thought gone): step down and rejoin as a player.
  relay.subscribe(topicOf(code, 'guests'), async data => {
    const env = await unpack<{ e?: number; h?: string }>(data);
    if (!env || closed) return;
    const e = env.e ?? 0, mine = room.lobby.epoch ?? 0;
    const beaten = e > mine || (e === mine && resuming && Boolean(env.h) && env.h! < myHid);
    if (!beaten) return;
    room.close();
    try { sessionStorage.setItem('ipl-auction-stepped-down', '1'); } catch { /* storage off */ }
    window.location.assign(`/r/${code}`);
  });

  // Route 2: the relay. Guests write to the host topic as { from, msg }.
  relay.subscribe(topicOf(code, 'host'), async data => {
    const env = await unpack<{ from: string; name?: string; msg: GuestMsg }>(data);
    if (!env || typeof env.from !== 'string' || !env.msg) return;
    let link = room.peers.get(env.from);
    if (!link || link.via !== 'relay') {
      // New, or back after the host dropped them (phone asleep): either way, (re)admit them.
      const id = env.from;
      link = { peer: id, label: String(env.name ?? '').slice(0, 20), via: 'relay', send: m => toGuests({ to: id, msg: m }), close: () => {} };
      add(link);
    }
    receive(link, env.msg);
  });

  // Ready when either route is up; fail only if both are down.
  await new Promise<void>((resolve, reject) => {
    let fails = 0;
    const ok = () => { host = room; resolve(); };
    const bad = () => { if (++fails === 2) { room.close(); reject(new Error('offline')); } };
    directReady.then(ok, bad);
    relay.ready.then(ok, bad);
  });
  if (resuming) room.sendLobby();
  return room;
}

// ---------------- guest ----------------

export interface GuestRoom {
  code: string;
  lobby: Lobby | null;
  state: GameState | null;
  error: string | null;
  connected: boolean;
  /** Which route is in use, or which one we're trying. */
  via: 'direct' | 'relay';
  me: string;          // my id in the room
  /** The host has gone and it's my turn to take over hosting (the screen does the switch). */
  takeover: boolean;
  /** Someone is taking over from a host who left: shown while it happens. */
  hostGone: boolean;
  /** My team in the room's seats (under any id I've used). */
  mine(): TeamId | null;
  listeners: Set<Listener>;
  send(msg: GuestMsg): void;
  close(): void;
}

/** How long the host can be silent before the first friend in line takes over (the next waits longer). */
const TAKEOVER_MS = 20000;
const TAKEOVER_STEP_MS = 10000;

/**
 * Build the lobby a friend hosts from: their latest copy, one host number higher, the old host's seat kept
 * for them as away (they can come back as a player on the same device), everyone else away until they check in.
 */
export function takeoverLobby(old: Lobby, myTeam: TeamId, myName: string): Lobby {
  const lobby: Lobby = structuredClone(old);
  const now = Date.now();
  lobby.epoch = (old.epoch ?? 0) + 1;
  lobby.host = myName;
  for (const [t, st] of Object.entries(lobby.seats) as [TeamId, Seat][]) {
    if (t === myTeam) lobby.seats[t] = { name: myName, peer: 'host', cid: deviceId() };
    else lobby.seats[t] = { ...st, peer: st.peer === 'host' ? 'gone-host' : st.peer, away: now };
  }
  return lobby;
}

let guest: GuestRoom | null = null;
export const guestRoom = () => guest;

/** Shift the host's clock times into this device's clock. */
function shiftTimes(s: GameState, delta: number) {
  if (s.lot) { s.lot.endsAt += delta; if (s.lot.plan) s.lot.plan.at += delta; }
  if (s.hold) s.hold += delta;
  if (s.rtm) s.rtm.at += delta;
}

/** How long the direct route gets before we switch to the relay. */
const DIRECT_MS = 7000;
/** How long the relay waits for the host to answer. */
const RELAY_MS = 15000;

export function joinRoom(code: string, name: string): GuestRoom {
  guest?.close();
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let relay: Relay | null = null;
  let toHost: ((v: unknown) => void) | null = null;
  let timer = 0;
  let closed = false;
  let lastState = 0;
  const relayId = 'r' + Math.random().toString(36).slice(2, 12);
  const cid = deviceId();
  /** My team, remembered so I can take it back after switching routes (my id changes). */
  let want: TeamId | null = null;
  const seatOf = (id: string) => room.lobby && (Object.entries(room.lobby.seats) as [TeamId, Seat][]).find(([, s]) => s.peer === id)?.[0];
  /** Every id I've had (direct, then relay): my seat may still be under an older one. */
  const myIds = new Set<string>();
  const mySeat = () => {
    const seats = Object.entries(room.lobby?.seats ?? {}) as [TeamId, Seat][];
    return seats.find(([, st]) => st.peer === room.me)?.[0] ?? seats.find(([, st]) => myIds.has(st.peer))?.[0] ?? null;
  };

  const room: GuestRoom = {
    code, lobby: null, state: null, error: null, connected: false, via: 'direct', me: '', takeover: false, hostGone: false, listeners: new Set(),
    mine: () => mySeat(),
    send(msg) {
      if (room.via === 'direct') { if (conn?.open) conn.send(msg); }
      else toHost?.({ from: relayId, name, msg });
    },
    close() {
      closed = true; clearTimeout(timer); clearInterval(ping); clearInterval(hello);
      document.removeEventListener('visibilitychange', onShow);
      peer?.destroy(); relay?.close();
      if (guest === room) guest = null;
    },
  };
  const ping = window.setInterval(() => {
    checkTakeover();
    if (!room.connected) return;
    room.send({ t: 'ping' });
    // No word from the host for 12 s (phone was asleep, link died quietly): reconnect and take my team back.
    if (Date.now() - lastHost > 12000) recover();
  }, 3000);
  /** My place in line to take over hosting: friends in the order they joined, skipping anyone away. -1 = not in line. */
  const myTurn = () => {
    const seats = (Object.values(room.lobby?.seats ?? {}) as Seat[]).filter(st => st.peer !== 'host' && st.peer !== 'gone-host' && !st.away);
    return seats.findIndex(st => st.peer === room.me || myIds.has(st.peer));
  };
  const checkTakeover = () => {
    if (closed || room.takeover || !room.lobby?.started || !room.state || room.state.phase === 'done') return;
    const silent = Date.now() - lastReal;
    if (silent > TAKEOVER_MS * 0.6 && !room.hostGone) { room.hostGone = true; changed(); if (room.via === 'direct') recover(); }
    const turn = myTurn();
    if (turn < 0 || document.visibilityState !== 'visible') return;
    if (silent > TAKEOVER_MS + turn * TAKEOVER_STEP_MS) { room.takeover = true; changed(); }
  };
  const recover = () => {
    if (closed) return;
    want = (room.me && seatOf(room.me)) || want;
    lastHost = Date.now();
    if (room.via === 'direct') { room.connected = false; useRelay(); }
    else toHost?.({ from: relayId, name, msg: { t: 'hello', name, cid } satisfies GuestMsg });
  };
  const onShow = () => {
    if (document.visibilityState !== 'visible' || !room.connected) return;
    room.send({ t: 'ping' });
    if (room.via === 'relay') toHost?.({ from: relayId, name, msg: { t: 'hello', name, cid } satisfies GuestMsg });
  };
  document.addEventListener('visibilitychange', onShow);
  let hello = 0;
  const changed = () => room.listeners.forEach(f => f());
  const fail = (text: string) => { clearTimeout(timer); room.connected = false; room.error = text; changed(); };

  let lastHost = Date.now();
  /** Last real word from a host (reconnect attempts don't count). */
  let lastReal = Date.now();
  let epoch = 0;
  let hostId: string | undefined;
  let hostEpoch = 0;
  let lastPick = 0;
  const onHost = (msg: HostMsg, e = epoch) => {
    if (e < epoch) return;            // an older host still talking after someone took over
    if (e > epoch) { epoch = e; lastState = 0; }
    if (msg.t === 'lobby' && room.lobby && (msg.lobby.epoch ?? 0) < (room.lobby.epoch ?? 0)) return;
    if (msg.t === 'bye') {
      // The host is closing: the first friend in line takes over in about 2 s.
      lastReal = Date.now() - TAKEOVER_MS + 2000;
      room.hostGone = true; changed();
      // The new host will be reachable on the relay, so go there now.
      if (room.via === 'direct') recover();
      return;
    }
    lastHost = Date.now();
    lastReal = Date.now();
    if (room.hostGone) room.hostGone = false;
    if (msg.t === 'pong') { changed(); return; }
    if (msg.t === 'lobby') {
      room.lobby = msg.lobby;
      if (want && seatOf(room.me) === want) want = null;
      else if (want && (!msg.lobby.seats[want] || msg.lobby.seats[want]!.name === name) && Date.now() - lastPick > 2000) {
        lastPick = Date.now();
        room.send({ t: 'pick', team: want });
      }
    }
    if (msg.t === 'error') room.error = msg.text;
    if (msg.t === 'state') {
      if (msg.now < lastState) return; // an older update arriving late
      lastState = msg.now;
      shiftTimes(msg.state, Date.now() - msg.now);
      room.state = msg.state;
    }
    changed();
  };
  const connectedNow = () => {
    clearTimeout(timer);
    if (room.connected) return;
    room.connected = true; room.error = null;
    changed();
  };

  // Route 2: the relay.
  const useRelay = () => {
    if (closed || room.via === 'relay') return;
    want = (room.me && seatOf(room.me)) || null;
    room.via = 'relay';
    if (room.me) myIds.add(room.me);
    room.me = relayId;
    myIds.add(relayId);
    conn?.close(); peer?.destroy(); conn = null; peer = null;
    changed();
    const r = openRelay(RELAY_MS);
    relay = r;
    toHost = orderedSender(r, topicOf(code, 'host'));
    r.subscribe(topicOf(code, 'guests'), async data => {
      const env = await unpack<{ to?: string; msg: HostMsg; e?: number; h?: string }>(data);
      if (!env?.msg || (env.to && env.to !== relayId)) return;
      if ((env.e ?? 0) < epoch) return;
      // Two friends took over at the same moment: everyone follows the same one (lower id); the other steps down.
      if ((env.e ?? 0) === epoch && env.h) {
        if (!hostId || (env.e ?? 0) > hostEpoch) { hostId = env.h; hostEpoch = env.e ?? 0; }
        else if (env.h !== hostId) { if (env.h < hostId) { hostId = env.h; lastState = 0; } else return; }
      } else if (env.h) { hostId = env.h; hostEpoch = env.e ?? 0; }
      if (env.msg.t === 'lobby' && !room.connected) { clearInterval(hello); connectedNow(); }
      onHost(env.msg, env.e ?? 0);
    });
    // Say hello until the host answers (the host may still be subscribing).
    const sayHello = () => toHost?.({ from: relayId, name, msg: { t: 'hello', name, cid } satisfies GuestMsg });
    r.ready.then(() => { sayHello(); hello = window.setInterval(() => { if (!room.connected) sayHello(); else clearInterval(hello); }, 2000); }, () => {});
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (room.connected || closed) return;
      fail(r.isOpen()
        ? 'No room with that code is open. Check the code, and ask the host to keep the auction on screen.'
        : 'Could not connect. Check your internet, then tap Try again.');
    }, RELAY_MS);
  };

  // Open the invite link with ?relay=1 to skip the direct route (useful to check the relay).
  let forceRelay = false;
  try { forceRelay = new URLSearchParams(window.location.search).get('relay') === '1'; } catch { /* no URL */ }
  if (forceRelay) { room.via = 'direct'; setTimeout(useRelay, 0); guest = room; return room; }

  // Route 1: direct.
  iceServers().then(list => {
    if (closed || room.via === 'relay') return;
    const p = new Peer({ config: { iceServers: list } });
    peer = p;
    keepAlive(p);
    timer = window.setTimeout(useRelay, DIRECT_MS);
    p.on('open', id => {
      if (room.via !== 'direct') return;
      room.me = id;
      myIds.add(id);
      const c = p.connect(PREFIX + code.toUpperCase(), { reliable: true });
      conn = c;
      c.on('open', () => { if (conn !== c) return; c.send({ t: 'hello', name, cid } satisfies GuestMsg); connectedNow(); });
      c.on('data', raw => { if (conn === c) onHost(raw as HostMsg); });
      c.on('close', () => {
        if (conn !== c || closed || room.via !== 'direct') return;
        // Lost the direct link mid-game: carry on over the relay.
        room.connected = false;
        useRelay();
      });
    });
    // Any direct-route problem (no PeerJS server, room not found there, network): try the relay.
    p.on('error', () => { if (!room.connected) useRelay(); });
  });
  guest = room;
  return room;
}

/**
 * The person playing a team in a friends room, or null for a bot. Uses the names saved in the game,
 * then the live room's seats (games started before names were saved still show them).
 */
export function personName(state: GameState, team: TeamId): string | null {
  if (!state.teams[team]?.human) return null;
  const saved = state.settings.names?.[team];
  if (saved) return saved;
  const seats = host?.lobby.seats ?? guest?.lobby?.seats;
  const seat = seats?.[team];
  // No room name for this team: on your own device that's you.
  return seat?.name ?? (team === state.settings.team ? 'You' : 'Friend');
}

/** True while the friend playing this team is unreachable (their seat is being kept for them). */
export function isAway(team: TeamId): boolean {
  const seats = host?.lobby.seats ?? guest?.lobby?.seats;
  return Boolean(seats?.[team]?.away);
}

// Development only: let test scripts look at the room.
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__rooms = () => ({ host, guest });
