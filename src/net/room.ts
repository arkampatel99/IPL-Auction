// Friends rooms over WebRTC (PeerJS). The host's browser runs the auction; guests connect to it
// directly and send their actions. No accounts or server of our own: PeerJS's free public
// service only introduces the browsers to each other.

import Peer, { type DataConnection } from 'peerjs';
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

export interface Seat { name: string; peer: string | 'host' }
export interface Lobby {
  code: string;
  host: string;
  settings: Omit<Settings, 'team' | 'seed' | 'humans'>;
  seats: Partial<Record<TeamId, Seat>>;
  started: boolean;
}

/** Guest → host */
export type GuestMsg =
  | { t: 'hello'; name: string }
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
  | { t: 'error'; text: string };

type Listener = () => void;

// ---------------- host ----------------

export interface HostRoom {
  lobby: Lobby;
  peers: Map<string, DataConnection>;
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

export async function createRoom(name: string, team: TeamId, settings: Lobby['settings']): Promise<HostRoom> {
  const code = newCode();
  const iceList = await iceServers();
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, { config: { iceServers: iceList } });
    keepAlive(peer);
    const room: HostRoom = {
      lobby: { code, host: name, settings, seats: { [team]: { name, peer: 'host' } }, started: false },
      peers: new Map(),
      listeners: new Set(),
      sendLobby() {
        const msg: HostMsg = { t: 'lobby', lobby: room.lobby };
        room.peers.forEach(c => c.open && c.send(msg));
        room.listeners.forEach(f => f());
      },
      sendState(state) {
        const msg: HostMsg = { t: 'state', state, now: Date.now() };
        room.peers.forEach(c => c.open && c.send(msg));
      },
      close() { peer.destroy(); host = null; },
    };
    let opened = false;
    peer.on('open', () => { if (opened) return; opened = true; host = room; resolve(room); });
    peer.on('error', err => { if (!opened) reject(err); });
    // A closed tab can take a minute to show up as a closed connection, so guests ping every 3 s
    // and anyone silent for 12 s counts as gone (a bot takes their team back).
    const seen = new Map<DataConnection, number>();
    const sweep = window.setInterval(() => {
      const now = Date.now();
      seen.forEach((at, c) => { if (now - at > 12000) { seen.delete(c); c.close(); c.emit('close'); } });
    }, 3000);
    peer.on('close', () => clearInterval(sweep));
    peer.on('connection', conn => {
      conn.on('open', () => { seen.set(conn, Date.now()); room.peers.set(conn.peer, conn); conn.send({ t: 'lobby', lobby: room.lobby } satisfies HostMsg); });
      conn.on('data', raw => {
        const msg = raw as GuestMsg;
        if (seen.has(conn)) seen.set(conn, Date.now());
        if (msg.t === 'ping') return;
        const seat = (Object.entries(room.lobby.seats) as [TeamId, Seat][]).find(([, s]) => s.peer === conn.peer);
        if (msg.t === 'hello') { (conn as DataConnection & { label: string }).label = msg.name.slice(0, 20); return; }
        if (msg.t === 'pick') {
          if (room.lobby.seats[msg.team]) { conn.send({ t: 'error', text: 'That team was just taken. Pick another.' } satisfies HostMsg); return; }
          const who = conn.label || 'Friend';
          if (room.lobby.started) {
            // Joining late: take over a bot's team. Only one team per person once the auction runs.
            if (seat) { conn.send({ t: 'error', text: 'You already have a team in this auction.' } satisfies HostMsg); return; }
            if (!room.onJoin?.(msg.team, who)) { conn.send({ t: 'error', text: 'You can join once the host is back on the auction screen.' } satisfies HostMsg); return; }
          } else if (seat) delete room.lobby.seats[seat[0]];
          room.lobby.seats[msg.team] = { name: who, peer: conn.peer };
          room.sendLobby();
          return;
        }
        if (seat) room.onAction?.(seat[0], msg);
      });
      let gone = false;
      conn.on('close', () => {
        if (gone) return;
        gone = true;
        seen.delete(conn);
        if (room.peers.get(conn.peer) === conn) room.peers.delete(conn.peer);
        for (const [team, s] of Object.entries(room.lobby.seats) as [TeamId, Seat][]) {
          if (s.peer !== conn.peer) continue;
          delete room.lobby.seats[team];
          if (room.lobby.started) room.onLeave?.(team);
        }
        room.sendLobby();
      });
    });
  });
}

// ---------------- guest ----------------

export interface GuestRoom {
  code: string;
  lobby: Lobby | null;
  state: GameState | null;
  error: string | null;
  connected: boolean;
  /** Still trying to reach the host (attempt number), shown while connecting. */
  attempt: number;
  me: string;          // my peer id
  listeners: Set<Listener>;
  send(msg: GuestMsg): void;
  close(): void;
}

let guest: GuestRoom | null = null;
export const guestRoom = () => guest;

/** Shift the host's clock times into this device's clock. */
function shiftTimes(s: GameState, delta: number) {
  if (s.lot) { s.lot.endsAt += delta; if (s.lot.plan) s.lot.plan.at += delta; }
  if (s.hold) s.hold += delta;
  if (s.rtm) s.rtm.at += delta;
}

const TRIES = 3;
const TRY_MS = 12000;

export function joinRoom(code: string, name: string): GuestRoom {
  guest?.close();
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let timer = 0;
  let closed = false;
  const ping = window.setInterval(() => { if (conn?.open) conn.send({ t: 'ping' } satisfies GuestMsg); }, 3000);
  const room: GuestRoom = {
    code, lobby: null, state: null, error: null, connected: false, attempt: 1, me: '', listeners: new Set(),
    send(msg) { if (conn?.open) conn.send(msg); },
    close() { closed = true; clearTimeout(timer); clearInterval(ping); peer?.destroy(); if (guest === room) guest = null; },
  };
  const changed = () => room.listeners.forEach(f => f());
  const fail = (text: string) => { clearTimeout(timer); room.connected = false; room.error = text; changed(); };

  const connect = () => {
    if (closed || !peer || peer.destroyed) return;
    conn?.close();
    const c = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
    conn = c;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (c.open || closed) return;
      if (room.attempt < TRIES) { room.attempt += 1; changed(); connect(); return; }
      fail("Could not reach the room. Ask the host to keep the auction open on their screen (not in the background), then tap Try again. On mobile data, try Wi-Fi.");
    }, TRY_MS);
    c.on('open', () => {
      if (conn !== c) return;
      clearTimeout(timer);
      room.connected = true; room.error = null;
      c.send({ t: 'hello', name } satisfies GuestMsg);
      // Rejoining after a drop: ask for my old team back if it's still free.
      const mine = room.lobby && (Object.entries(room.lobby.seats) as [TeamId, Seat][]).find(([, s]) => s.peer === room.me)?.[0];
      if (mine) c.send({ t: 'pick', team: mine } satisfies GuestMsg);
      changed();
    });
    c.on('data', raw => {
      if (conn !== c) return;
      const msg = raw as HostMsg;
      if (msg.t === 'lobby') room.lobby = msg.lobby;
      if (msg.t === 'error') room.error = msg.text;
      if (msg.t === 'state') { shiftTimes(msg.state, Date.now() - msg.now); room.state = msg.state; }
      changed();
    });
    c.on('error', () => { /* the timer retries */ });
    c.on('close', () => {
      if (conn !== c || closed) return;
      if (room.connected) fail('Lost the connection to the host. Tap Try again to rejoin.');
    });
  };

  iceServers().then(list => {
    if (closed) return;
    const p = new Peer({ config: { iceServers: list } });
    peer = p;
    keepAlive(p);
    p.on('open', id => {
      room.me = id;
      if (!conn) connect();
    });
    p.on('error', err => {
      const type = String(err.type);
      if (type === 'peer-unavailable') fail('No room with that code. The host may have closed it, or the code is wrong.');
      else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') { /* keepAlive reconnects */ }
      else if (!room.connected) fail('Could not connect. Check your internet and tap Try again.');
    });
  });
  guest = room;
  return room;
}
