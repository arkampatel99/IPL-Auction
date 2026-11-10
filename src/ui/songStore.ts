// Team songs you add yourself, kept in this browser (IndexedDB). Nothing is uploaded anywhere.

import type { TeamId } from '../data/teams';

export interface TeamSong { team: TeamId; name: string; blob: Blob; start: number; length: number }

const DB = 'ipl-auction';
const STORE = 'songs';
const cache = new Map<TeamId, { song: TeamSong; url: string }>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'team' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function remember(song: TeamSong) {
  const old = cache.get(song.team);
  if (old) URL.revokeObjectURL(old.url);
  cache.set(song.team, { song, url: URL.createObjectURL(song.blob) });
}

/** Load saved songs into memory at startup so they play instantly. */
export async function loadSongs() {
  try {
    const all = await tx<TeamSong[]>('readonly', s => s.getAll() as IDBRequest<TeamSong[]>);
    all.forEach(remember);
  } catch { /* storage blocked: generated tunes still play */ }
}

export async function saveSong(song: TeamSong) {
  await tx('readwrite', s => s.put(song));
  remember(song);
}

export async function removeSong(team: TeamId) {
  await tx('readwrite', s => s.delete(team));
  const old = cache.get(team);
  if (old) URL.revokeObjectURL(old.url);
  cache.delete(team);
}

export const savedSong = (team: TeamId) => cache.get(team) ?? null;
