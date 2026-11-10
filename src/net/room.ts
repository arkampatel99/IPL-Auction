// Friends rooms over WebRTC (PeerJS). The host's browser runs the auction; guests connect to it
// directly and send their actions. No accounts or server of our own: PeerJS's free public
// service only introduces the browsers to each other.

import Peer, { type DataConnection } from 'peerjs';
import type { TeamId } from '../data/teams';
import type { GameState, Settings } from '../game/engine';

const PREFIX = 'iplauctionroom-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I

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
  listeners: Set<Listener>;
  sendLobby(): void;
  sendState(state: GameState): void;
  close(): void;
}

let host: HostRoom | null = null;
export const hostRoom = () => host;

export function createRoom(name: string, team: TeamId, settings: Lobby['settings']): Promise<HostRoom> {
  const code = newCode();
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code);
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
    peer.on('open', () => { host = room; resolve(room); });
    peer.on('error', err => reject(err));
    peer.on('connection', conn => {
      conn.on('open', () => { room.peers.set(conn.peer, conn); conn.send({ t: 'lobby', lobby: room.lobby } satisfies HostMsg); });
      conn.on('data', raw => {
        const msg = raw as GuestMsg;
        const seat = (Object.entries(room.lobby.seats) as [TeamId, Seat][]).find(([, s]) => s.peer === conn.peer);
        if (msg.t === 'hello') { (conn as DataConnection & { label: string }).label = msg.name.slice(0, 20); return; }
        if (msg.t === 'pick') {
          if (room.lobby.started) { conn.send({ t: 'error', text: 'The auction has already started.' } satisfies HostMsg); return; }
          if (room.lobby.seats[msg.team]) { conn.send({ t: 'error', text: 'That team was just taken. Pick another.' } satisfies HostMsg); return; }
          if (seat) delete room.lobby.seats[seat[0]];
          room.lobby.seats[msg.team] = { name: conn.label || 'Friend', peer: conn.peer };
          room.sendLobby();
          return;
        }
        if (seat) room.onAction?.(seat[0], msg);
      });
      conn.on('close', () => {
        room.peers.delete(conn.peer);
        if (!room.lobby.started) {
          for (const [team, s] of Object.entries(room.lobby.seats) as [TeamId, Seat][]) if (s.peer === conn.peer) delete room.lobby.seats[team];
          room.sendLobby();
        }
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

export function joinRoom(code: string, name: string): GuestRoom {
  guest?.close();
  const peer = new Peer();
  const room: GuestRoom = {
    code, lobby: null, state: null, error: null, connected: false, me: '', listeners: new Set(),
    send(msg) { conn?.open && conn.send(msg); },
    close() { peer.destroy(); if (guest === room) guest = null; },
  };
  let conn: DataConnection | null = null;
  const changed = () => room.listeners.forEach(f => f());
  peer.on('open', id => {
    room.me = id;
    conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
    conn.on('open', () => { room.connected = true; room.error = null; conn!.send({ t: 'hello', name } satisfies GuestMsg); changed(); });
    conn.on('data', raw => {
      const msg = raw as HostMsg;
      if (msg.t === 'lobby') room.lobby = msg.lobby;
      if (msg.t === 'error') room.error = msg.text;
      if (msg.t === 'state') { shiftTimes(msg.state, Date.now() - msg.now); room.state = msg.state; }
      changed();
    });
    conn.on('close', () => { room.connected = false; room.error = 'The host left, so the room has closed.'; changed(); });
  });
  peer.on('error', err => {
    room.error = String(err.type) === 'peer-unavailable' ? 'No room with that code. Check the code and try again.' : 'Could not connect. Check your internet and try again.';
    changed();
  });
  guest = room;
  return room;
}
