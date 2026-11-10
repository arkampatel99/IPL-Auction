// Imports the official TATA IPL 2026 auction list (BCCI, 8 Dec 2025: 350 players, 42 sets)
// into scripts/data/ipl-2026-auction-list.json, which build-players.mjs reads.
// Needs `pdftotext` (poppler-utils). Run: node scripts/import-auction-list.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache/auction');
const OUT = path.join(ROOT, 'scripts/data/ipl-2026-auction-list.json');
// Copy of the official PDF (the iplt20.com original blocks scripted downloads).
const URL = 'https://bsmedia.business-standard.com/_media/bs/data/general-file-upload/2025-12/' +
  'IPL%20auction%202026%20full%20list%20of%20players%20-%20batters,%20bowlers,%20all-rounders,%20wicketkeepers%20list%20Indian%20premier%20league.pdf';

const ROW = /^\s*(\d+)\s+(\d+)\s+([A-Z]+\d+)\s+(.+?)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d+)\s+(BATTER|ALL-ROUNDER|WICKETKEEPER|BOWLER)\s+(RHB|LHB)\s*(.*?)\s+(Capped|Uncapped|Associate)\s+(\d+)\s+(.+?)\s*$/;
const TEAMS = /\b(CSK|MI|RCB|KKR|SRH|RR|DC|PBKS|LSG|GT)\b/;
const ROLE = { BATTER: 'BAT', 'ALL-ROUNDER': 'AR', WICKETKEEPER: 'WK', BOWLER: 'BOWL' };

fs.mkdirSync(CACHE, { recursive: true });
const pdf = path.join(CACHE, 'list.pdf');
if (!fs.existsSync(pdf) || fs.statSync(pdf).size < 10000) {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  fs.writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
}
const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });

const players = [];
for (const line of text.split('\n')) {
  const m = ROW.exec(line);
  if (!m) continue;
  const [, sr, setNo, set, mid, , , spec, , rest, cu, price] = m;
  // mid = "First   Surname   Country   [State]" (columns separated by 2+ spaces)
  const parts = mid.split(/\s{2,}/);
  const country = parts.find(p => /^[A-Z][a-z]/.test(p) && !/^[A-Z]{2,5}$/.test(p) && parts.indexOf(p) >= 2) ?? parts[2];
  const ci = parts.indexOf(country);
  const first = parts.slice(0, ci - 1).join(' ');
  const surname = parts[ci - 1];
  const style = (rest.match(/^([A-Za-z ]+?)(?=\s+\d|\s{2,}|\s*$)/)?.[1] ?? '').trim();
  const team2025 = rest.match(TEAMS)?.[1] ?? null;
  players.push({
    sr: +sr, setNo: +setNo, set,
    name: `${first} ${surname}`.replace(/\s+/g, ' ').trim(), first, surname,
    country, role: ROLE[spec], bowling: style || null,
    capped: cu === 'Capped', base: +price, team2025,
  });
}
if (players.length !== 350) console.warn(`expected 350 players, parsed ${players.length}`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(players, null, 1));
console.log(`wrote ${players.length} players in ${new Set(players.map(p => p.set)).size} sets to ${path.relative(ROOT, OUT)}`);
