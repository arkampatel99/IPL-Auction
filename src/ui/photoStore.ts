// Player photos you add yourself, kept in this browser (IndexedDB). Nothing is uploaded anywhere.

const DB = 'ipl-auction-photos';
const STORE = 'photos';
const cache = new Map<string, string>(); // player id -> object URL
const listeners = new Set<() => void>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
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

const changed = () => listeners.forEach(f => f());
export function onPhotosChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

/** Load saved photos at startup so cards show them straight away. */
export async function loadPhotos() {
  try {
    const all = await tx<{ id: string; blob: Blob }[]>('readonly', s => s.getAll() as IDBRequest<{ id: string; blob: Blob }[]>);
    for (const p of all) cache.set(p.id, URL.createObjectURL(p.blob));
    changed();
  } catch { /* storage blocked */ }
}

/** Shrink to 300 px wide JPEG so hundreds of photos stay small. */
async function shrink(file: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const w = Math.min(300, bmp.width), h = Math.round(bmp.height * (w / bmp.width));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    return await new Promise(r => c.toBlob(b => r(b ?? file), 'image/jpeg', 0.86));
  } catch { return file; }
}

export async function savePhoto(id: string, file: Blob) {
  const blob = await shrink(file);
  await tx('readwrite', s => s.put({ id, blob }));
  const old = cache.get(id);
  if (old) URL.revokeObjectURL(old);
  cache.set(id, URL.createObjectURL(blob));
  changed();
}

export async function removePhoto(id: string) {
  await tx('readwrite', s => s.delete(id));
  const old = cache.get(id);
  if (old) URL.revokeObjectURL(old);
  cache.delete(id);
  changed();
}

export const savedPhoto = (id: string) => cache.get(id) ?? null;
export const photoCount = () => cache.size;

/** File name to use in public/players/, e.g. "Yash Dhull" -> "yash-dhull". */
export const photoSlug = (name: string) =>
  name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
