// Finds openly licensed photos (Creative Commons / public domain) for players who have none,
// using the Openverse API (Flickr, Wikimedia and other open collections). Keeps credits.
// Writes scripts/data/open-photos.json; build-players.mjs merges it. Run: npm run photos

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYERS = path.join(ROOT, 'src/data/players.json');
const OUT = path.join(ROOT, 'scripts/data/open-photos.json');
const UA = 'ipl-auction-game/0.1 (personal, non-commercial)';
const CRICKET = /\b(cricket|cricketer|ipl|t20|odi|test match|wicket|batsman|batter|bowler|bowling|batting|innings|premier league|world cup|ranji|super kings|indians|knight riders|royals|capitals|titans|giants|sunrisers|challengers|punjab kings)\b/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const players = JSON.parse(fs.readFileSync(PLAYERS, 'utf8'));
const found = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const todo = players.filter(p => !p.img && !(p.id in found));
console.log(`${todo.length} players to look up`);

let added = 0;
for (const [i, p] of todo.entries()) {
  const words = norm(p.name).split(' ').filter(w => w.length > 1);
  if (words.length < 2) { found[p.id] = null; continue; }
  const url = `https://api.openverse.org/v1/images/?page_size=20&q=${encodeURIComponent(`${p.name} cricket`)}`;
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(1500); // polite: well under anonymous rate limits
    res = await fetch(url, { headers: { 'User-Agent': UA } }).catch(() => null);
    if (res && res.status !== 429) break;
    await sleep(30000); // asked to slow down: wait, then retry
  }
  if (!res?.ok) { console.warn(`skip ${p.name}: ${res?.status}`); continue; }
  const { results = [] } = await res.json();
  const hit = results.find(r => {
    const title = norm(r.title ?? '');
    const tags = (r.tags ?? []).map(t => t.name).join(' ');
    return words.every(w => title.split(' ').includes(w)) && (CRICKET.test(r.title ?? '') || CRICKET.test(tags) || CRICKET.test(r.description ?? ''));
  });
  found[p.id] = hit ? {
    url: hit.thumbnail ?? hit.url,
    credit: `${hit.title} · ${hit.creator ?? 'unknown'} · ${String(hit.license).toUpperCase()} ${hit.license_version ?? ''} · ${hit.source}`.replace(/\s+/g, ' ').trim(),
    page: hit.foreign_landing_url ?? null,
  } : null;
  if (hit) { added++; console.log(`  found ${p.name}: ${found[p.id].credit}`); }
  if (i % 10 === 0) fs.writeFileSync(OUT, JSON.stringify(found, null, 1));
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(found, null, 1));
console.log(`done: ${added} new photos, ${Object.values(found).filter(Boolean).length} in total`);
