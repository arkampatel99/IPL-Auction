// Builds src/data/players.json from open data.
//   Stats + teams:  Cricsheet IPL ball-by-ball (https://cricsheet.org)
//   Caps/country:   Cricsheet T20I + ODI files
//   Name + photo:   Wikidata, matched by ESPNcricinfo ID
// Run: npm run data   (downloads ~40 MB into .cache/ on first run)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'src/data/players.json');
const UA = 'ipl-auction-game/0.1 (personal, non-commercial)';
const POOL_SEASONS = ['2025', '2026'];   // players who played in these seasons
const RECENT = ['2024', '2025', '2026']; // used for role + form

const TEAM_CODES = {
  'Chennai Super Kings': 'CSK', 'Mumbai Indians': 'MI',
  'Royal Challengers Bengaluru': 'RCB', 'Royal Challengers Bangalore': 'RCB',
  'Kolkata Knight Riders': 'KKR', 'Sunrisers Hyderabad': 'SRH', 'Rajasthan Royals': 'RR',
  'Delhi Capitals': 'DC', 'Delhi Daredevils': 'DC', 'Punjab Kings': 'PBKS', 'Kings XI Punjab': 'PBKS',
  'Lucknow Super Giants': 'LSG', 'Gujarat Titans': 'GT',
};
// Cricsheet has no keeper flag; stumpings catch most keepers, this list catches the rest.
const KEEPERS = ['RR Pant', 'SV Samson', 'H Klaasen', 'Ishan Kishan', 'JM Sharma', 'KL Rahul', 'MS Dhoni',
  'JC Buttler', 'Q de Kock', 'Dhruv Jurel', 'RD Rickelton', 'JP Inglis', 'N Pooran', 'PD Salt', 'Abishek Porel',
  'Anuj Rawat', 'P Simran Singh', 'Rahmanullah Gurbaz', 'J Fraser-McGurk', 'KS Bharat', 'WP Saha', 'Kumar Kushagra'];

// Spinners who bowl a lot in the powerplay, so the overs heuristic below calls them pace.
const SPINNERS = ['SP Narine', 'M Theekshana', 'Washington Sundar', 'R Ashwin', 'Mujeeb Ur Rahman', 'MJ Santner', 'Mohammad Nabi', 'KH Pandya'];

async function download(name, url) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  console.log('downloading', url);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, buf);
  return buf;
}

function* matches(zipBuf) {
  const files = unzipSync(new Uint8Array(zipBuf), { filter: f => f.name.endsWith('.json') });
  for (const name in files) yield JSON.parse(strFromU8(files[name]));
}

const blank = () => ({ m: 0, inn: 0, runs: 0, balls: 0, outs: 0, bb: 0, rc: 0, wk: 0, st: 0, mid: 0 });
const NOT_BOWLER_WICKET = new Set(['run out', 'retired hurt', 'retired out', 'obstructing the field']);

async function main() {
  const [ipl, t20i, odi, peopleCsv] = await Promise.all([
    download('ipl.zip', 'https://cricsheet.org/downloads/ipl_male_json.zip'),
    download('t20i.zip', 'https://cricsheet.org/downloads/t20s_male_json.zip'),
    download('odi.zip', 'https://cricsheet.org/downloads/odis_male_json.zip'),
    download('people.csv', 'https://cricsheet.org/register/people.csv'),
  ]);
  // Franchise T20 leagues around the world (for overseas players with buzz who haven't played IPL).
  const LEAGUES = ['bbl', 'sat', 'psl', 'cpl', 'ilt', 'mlc', 'hnd', 'bpl', 'ntb'];
  const leagueZips = await Promise.all(LEAGUES.map(l => download(`${l}.zip`, `https://cricsheet.org/downloads/${l}_male_json.zip`)));

  // id -> { name, career, seasons{yr: stats}, lastTeam, lastSeason }
  const P = new Map();
  const get = (id, name) => {
    if (!P.has(id)) P.set(id, { id, short: name, career: blank(), seasons: {}, lastTeam: null, lastSeason: '' });
    return P.get(id);
  };
  for (const d of matches(ipl)) {
    const info = d.info;
    const season = String(info.season).slice(0, 4);
    const reg = info.registry.people;
    const touched = new Set();
    const stat = (name) => {
      const p = get(reg[name], name);
      p.seasons[season] ??= blank();
      return [p.career, p.seasons[season]];
    };
    for (const [team, names] of Object.entries(info.players)) {
      for (const n of names) {
        const p = get(reg[n], n);
        for (const s of stat(n)) s.m++;
        if (season >= p.lastSeason) { p.lastSeason = season; p.lastTeam = TEAM_CODES[team] ?? null; }
      }
    }
    for (const inn of d.innings ?? []) {
      if (inn.super_over) continue;
      const batted = new Set();
      for (const over of inn.overs) for (const dl of over.deliveries) {
        const ex = dl.extras ?? {};
        const bat = stat(dl.batter); batted.add(dl.batter);
        const legal = !ex.wides;
        for (const s of bat) { s.runs += dl.runs.batter; if (legal) s.balls++; }
        const bowl = stat(dl.bowler);
        for (const s of bowl) {
          if (!ex.wides && !ex.noballs) { s.bb++; if (over.over >= 6 && over.over <= 14) s.mid++; }
          s.rc += dl.runs.batter + (ex.wides ?? 0) + (ex.noballs ?? 0);
        }
        for (const w of dl.wickets ?? []) {
          batted.add(w.player_out);
          for (const s of stat(w.player_out)) s.outs++;
          if (!NOT_BOWLER_WICKET.has(w.kind)) for (const s of bowl) s.wk++;
          if (w.kind === 'stumped') for (const f of w.fielders ?? []) if (f.name) for (const s of stat(f.name)) s.st++;
        }
      }
      for (const n of batted) for (const s of stat(n)) s.inn++;
      touched.add(1);
    }
  }

  // International caps: the country a player appeared for most (ignoring World XI style teams).
  // League stats since 2024 (BBL seasons look like "2024/25").
  const LEAGUE = new Map(); // id -> stats (all leagues since 2024)
  const leagueNames = new Map(); // id -> Cricsheet name
  const LEAGUE_NAME = { bbl: 'Big Bash League', sat: 'SA20', psl: 'Pakistan Super League', cpl: 'Caribbean Premier League', ilt: 'ILT20', mlc: 'Major League Cricket', hnd: 'The Hundred', bpl: 'Bangladesh Premier League', ntb: 'T20 Blast' };
  const BY_LEAGUE = new Map(); // `${code}|${id}` -> stats (all seasons), for the per-competition table
  for (const [li, zip] of leagueZips.entries()) for (const d of matches(zip)) {
    const code = LEAGUES[li];
    const recentSeason = String(d.info.season).slice(0, 4) >= '2024';
    const reg = d.info.registry.people;
    const one = (map, key) => { if (!map.has(key)) map.set(key, blank()); return map.get(key); };
    // Stats object for a player in this match: all-time per league, plus since-2024 across leagues.
    const st = n => {
      const id = reg[n]; leagueNames.set(id, n);
      const a = one(BY_LEAGUE, `${code}|${id}`);
      const b = recentSeason ? one(LEAGUE, id) : null;
      return { add(k, v) { a[k] += v; if (b) b[k] += v; } };
    };
    for (const names of Object.values(d.info.players)) for (const n of names) st(n).add('m', 1);
    for (const inn of d.innings ?? []) {
      if (inn.super_over) continue;
      const batted = new Set();
      for (const over of inn.overs) for (const dl of over.deliveries) {
        const ex = dl.extras ?? {};
        const bat = st(dl.batter); batted.add(dl.batter);
        bat.add('runs', dl.runs.batter); if (!ex.wides) bat.add('balls', 1);
        const bowl = st(dl.bowler);
        if (!ex.wides && !ex.noballs) { bowl.add('bb', 1); if (over.over >= 6 && over.over <= 14) bowl.add('mid', 1); }
        bowl.add('rc', dl.runs.batter + (ex.wides ?? 0) + (ex.noballs ?? 0));
        for (const w of dl.wickets ?? []) {
          batted.add(w.player_out); st(w.player_out).add('outs', 1);
          if (!NOT_BOWLER_WICKET.has(w.kind)) bowl.add('wk', 1);
          if (w.kind === 'stumped') for (const f of w.fielders ?? []) if (f.name) st(f.name).add('st', 1);
        }
      }
      for (const n of batted) st(n).add('inn', 1);
    }
  }
  if (false) for (const zip of []) for (const d of matches(zip)) {
    const reg = d.info.registry.people;
    const st = n => { const id = reg[n]; leagueNames.set(id, n); if (!LEAGUE.has(id)) LEAGUE.set(id, blank()); return LEAGUE.get(id); };
    for (const names of Object.values(d.info.players)) for (const n of names) st(n).m++;
    for (const inn of d.innings ?? []) {
      if (inn.super_over) continue;
      const batted = new Set();
      for (const over of inn.overs) for (const dl of over.deliveries) {
        const ex = dl.extras ?? {};
        const bat = st(dl.batter); batted.add(dl.batter);
        bat.runs += dl.runs.batter; if (!ex.wides) bat.balls++;
        const bowl = st(dl.bowler);
        if (!ex.wides && !ex.noballs) { bowl.bb++; if (over.over >= 6 && over.over <= 14) bowl.mid++; }
        bowl.rc += dl.runs.batter + (ex.wides ?? 0) + (ex.noballs ?? 0);
        for (const w of dl.wickets ?? []) {
          batted.add(w.player_out); st(w.player_out).outs++;
          if (!NOT_BOWLER_WICKET.has(w.kind)) bowl.wk++;
          if (w.kind === 'stumped') for (const f of w.fielders ?? []) if (f.name) st(f.name).st++;
        }
      }
      for (const n of batted) st(n).inn++;
    }
  }

  const T20I = new Map(); // id -> career stats in T20 internationals
  const WC = new Map();   // id -> T20 World Cup stats
  for (const d of matches(t20i)) {
    const reg = d.info.registry.people;
    const wc = /world cup/i.test(d.info.event?.name ?? '') && !/qualifier|regional/i.test(d.info.event?.name ?? '');
    const both = (a, b) => new Proxy(a, { set(t, k, v) { const diff = v - t[k]; t[k] = v; if (b) b[k] += diff; return true; } });
    const st = n => {
      const id = reg[n];
      if (!T20I.has(id)) T20I.set(id, blank());
      if (wc && !WC.has(id)) WC.set(id, blank());
      return both(T20I.get(id), wc ? WC.get(id) : null);
    };
    for (const names of Object.values(d.info.players)) for (const n of names) st(n).m++;
    for (const inn of d.innings ?? []) {
      if (inn.super_over) continue;
      const batted = new Set();
      for (const over of inn.overs) for (const dl of over.deliveries) {
        const ex = dl.extras ?? {};
        const bat = st(dl.batter); batted.add(dl.batter);
        bat.runs += dl.runs.batter; if (!ex.wides) bat.balls++;
        const bowl = st(dl.bowler);
        if (!ex.wides && !ex.noballs) bowl.bb++;
        bowl.rc += dl.runs.batter + (ex.wides ?? 0) + (ex.noballs ?? 0);
        for (const w of dl.wickets ?? []) {
          batted.add(w.player_out); st(w.player_out).outs++;
          if (!NOT_BOWLER_WICKET.has(w.kind)) bowl.wk++;
        }
      }
      for (const n of batted) st(n).inn++;
    }
  }

  const caps = new Map();
  const intlNames = new Map(); // id -> Cricsheet name, for matching the auction list
  for (const zip of [odi, t20i]) for (const d of matches(zip)) {
    const reg = d.info.registry.people;
    for (const [team, names] of Object.entries(d.info.players)) {
      if (/\bXI\b/.test(team)) continue;
      for (const n of names) {
        intlNames.set(reg[n], n);
        const c = caps.get(reg[n]) ?? {};
        c[team] = (c[team] ?? 0) + 1;
        caps.set(reg[n], c);
      }
    }
  }
  const country = new Map([...caps].map(([id, c]) => [id, Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]]));

  // ESPNcricinfo IDs from the people register.
  const lines = strFromU8(new Uint8Array(peopleCsv)).split('\n');
  const cols = lines[0].split(',');
  const iId = cols.indexOf('identifier'), iCi = cols.indexOf('key_cricinfo');
  const cricinfo = new Map();
  for (const l of lines.slice(1)) { const c = l.split(','); if (c[iCi]) cricinfo.set(c[iId], c[iCi]); }

  // Official IPL 2026 auction list (see import-auction-list.mjs), matched to Cricsheet by name.
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/data/ipl-2026-auction-list.json'), 'utf8'));
  const norm = x => x.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const names = new Map([...intlNames, ...[...P.values()].map(p => [p.id, p.short])]);
  const bySurname = new Map();
  for (const [id, n] of names) {
    const last = norm(n).split(' ').at(-1);
    if (!bySurname.has(last)) bySurname.set(last, []);
    bySurname.get(last).push([id, n]);
  }
  // Score every (list entry, Cricsheet player) pair, then assign best-first so each record is used once.
  const pairs = [];
  for (const e of list) {
    const first = norm(e.first), sur = norm(e.surname), full = `${first} ${sur}`;
    for (const [id, n] of bySurname.get(sur.split(' ').at(-1)) ?? []) {
      const t = norm(n).split(' ');
      let sc = 0;
      if (norm(n) === full || norm(n) === `${first.split(' ')[0]} ${sur}`) sc = 100;
      else if (t[0] === first.split(' ')[0]) sc = 90;
      else if (t[0].length <= 3 && t[0][0] === first.replace(/ /g, '')[0]) sc = 50; // initials, e.g. "DP Conway"
      if (!sc) continue;
      if (P.has(id)) sc += 20 + (P.get(id).lastSeason >= '2024' ? 5 : 0);
      if (country.get(id) === e.country) sc += 15;
      // Only ODI/T20I caps are in the data (Test-only players look uncapped), so penalise one way only:
      if (!e.capped && country.has(id)) sc -= 15;
      // A brand-new uncapped name at base price is unlikely to be an IPL regular.
      if (!e.capped && e.base <= 30 && !e.team2025 && (P.get(id)?.career.m ?? 0) >= 20) sc -= 25;
      if (sc >= 65) pairs.push({ e, id, sc });
    }
  }
  pairs.sort((x, y) => y.sc - x.sc);
  const usedIds = new Set();
  for (const { e, id } of pairs) {
    if (e.id || usedIds.has(id)) continue;
    e.id = id; usedIds.add(id);
  }

  // Names Cricsheet spells differently (e.g. Hasaranga = "PWH de Silva"): look the official name
  // up on Wikidata, take its ESPNcricinfo ID, and map that back to Cricsheet's register.
  const byCricinfo = new Map();
  for (const l of lines.slice(1)) { const c = l.split(','); if (c[iCi]) byCricinfo.set(c[iCi], c[iId]); }
  const unmatched = list.filter(e => !e.id);
  for (let i = 0; i < unmatched.length; i += 80) {
    const batch = unmatched.slice(i, i + 80);
    const values = batch.map(e => `"${e.name.replace(/"/g, '')}"@en`).join(' ');
    const q = `SELECT ?label ?ci WHERE { VALUES ?label { ${values} } ?p rdfs:label|skos:altLabel ?label ; wdt:P2697 ?ci . }`;
    const res = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(q), {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
    });
    if (!res.ok) { console.warn('wikidata name lookup failed', res.status); continue; }
    const hits = new Map();
    for (const b of (await res.json()).results.bindings) {
      const k = b.label.value;
      hits.set(k, hits.has(k) ? null : b.ci.value); // null = ambiguous name
    }
    for (const e of batch) {
      const id = byCricinfo.get(hits.get(e.name) ?? '');
      if (id && !usedIds.has(id)) { e.id = id; usedIds.add(id); }
    }
  }

  const listById = new Map();
  let matched = 0;
  for (const e of list) {
    if (e.id) matched++; else e.id = `a${e.sr}`;
    listById.set(e.id, e);
  }
  console.log(`auction list: matched ${matched} of ${list.length} to Cricsheet`);

  const pool = [...P.values()].filter(p => POOL_SEASONS.some(s => p.seasons[s]?.m > 0) || listById.has(p.id));
  for (const e of list) if (!P.has(e.id)) pool.push({ id: e.id, short: e.name, career: blank(), seasons: {}, mid: 0, lastTeam: null, listOnly: true });

  // Overseas players with buzz: the best recent franchise-league performers not already in the game.
  const inPool = new Set(pool.map(p => p.id));
  const batIdx = s => (s.inn >= 10 && s.balls >= 150 ? (s.runs / s.inn) * ((s.runs / s.balls) * 100 / 130) : 0);
  const bowlIdx = s => (s.bb >= 180 ? (s.wk / (s.bb / 24)) * 20 + (9.6 - (s.rc / s.bb) * 6) * 8 : 0);
  const cands = [...LEAGUE].filter(([id, s]) => !inPool.has(id) && s.m >= 12 && country.get(id) !== 'India');
  const topBat = [...cands].sort((a, b) => batIdx(b[1]) - batIdx(a[1])).slice(0, 90);
  const topBowl = [...cands].sort((a, b) => bowlIdx(b[1]) - bowlIdx(a[1])).slice(0, 90);
  const buzz = [...new Map([...topBat, ...topBowl].map(x => [x[0], x])).values()].slice(0, 170);
  for (const [id] of buzz) pool.push({ id, short: leagueNames.get(id), career: blank(), seasons: {}, mid: 0, lastTeam: null, leagueOnly: true });
  console.log(`added ${buzz.length} overseas league players; pool size`, pool.length);

  // Wikidata: full name, photo, sporting country.
  const wiki = new Map();
  const ids = [...new Set([...pool.map(p => p.id), ...list.map(e => e.id)].map(id => cricinfo.get(id)).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 150) {
    const values = ids.slice(i, i + 150).map(x => `"${x}"`).join(' ');
    const q = `SELECT ?id ?pLabel ?img ?cLabel ?zLabel ?article WHERE { VALUES ?id { ${values} } ?p wdt:P2697 ?id .
      OPTIONAL { ?p wdt:P18 ?img } OPTIONAL { ?article schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> } OPTIONAL { ?p wdt:P1532 ?c } OPTIONAL { ?p wdt:P27 ?z }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
    const res = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(q), {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
    });
    if (!res.ok) { console.warn('wikidata failed', res.status); continue; }
    for (const b of (await res.json()).results.bindings) {
      const prev = wiki.get(b.id.value) ?? {};
      wiki.set(b.id.value, {
        name: prev.name ?? b.pLabel?.value,
        img: prev.img ?? b.img?.value,
        country: prev.country ?? b.cLabel?.value ?? b.zLabel?.value,
        article: prev.article ?? b.article?.value,
      });
    }
  }

  // No Wikidata photo: try the lead image of the English Wikipedia article (free images only).
  const missing = [...wiki.values()].filter(w => !w.img && w.article);
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const titles = batch.map(w => decodeURIComponent(w.article.split('/wiki/')[1]).replace(/_/g, ' '));
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=thumbnail' +
      '&pithumbsize=240&pilicense=free&redirects=1&titles=' + encodeURIComponent(titles.join('|'));
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const q = (await res.json()).query ?? {};
    const norm = new Map([...(q.normalized ?? []), ...(q.redirects ?? [])].map(x => [x.from, x.to]));
    const byTitle = new Map(Object.values(q.pages ?? {}).map(pg => [pg.title, pg.thumbnail?.source]));
    batch.forEach((w, j) => {
      let t = titles[j]; while (norm.has(t)) t = norm.get(t);
      if (byTitle.get(t)) w.thumb = byTitle.get(t);
    });
  }

  const sum = (p, yrs) => yrs.reduce((a, y) => {
    const s = p.seasons[y]; if (s) for (const k in a) a[k] += s[k]; return a;
  }, blank());

  const out = pool.map(p => {
    const w = wiki.get(cricinfo.get(p.id)) ?? {};
    const capCountry = country.get(p.id);
    // League-only players with no caps and no country on record: use the league they mostly play in.
    const LEAGUE_HOME = { bbl: 'Australia', sat: 'South Africa', psl: 'Pakistan', cpl: 'West Indies', ilt: 'United Arab Emirates', mlc: 'United States of America', hnd: 'England', bpl: 'Bangladesh', ntb: 'England' };
    const homeLeague = p.leagueOnly ? LEAGUES.map(c => [c, BY_LEAGUE.get(`${c}|${p.id}`)?.m ?? 0]).sort((x, y) => y[1] - x[1])[0][0] : null;
    const wikiCountry = w.country && !/^Q\d+$/.test(w.country) ? (w.country === 'United Kingdom' ? 'England' : w.country) : null;
    const nation = capCountry ?? wikiCountry ?? (homeLeague ? LEAGUE_HOME[homeLeague] : 'India');
    const recent = sum(p, RECENT);
    const lg = LEAGUE.get(p.id);
    const roleStats = p.leagueOnly || (!recent.m && lg) ? lg : recent;
    const per = roleStats.m || 1;
    const bowlPerMatch = roleStats.bb / per, runsPerMatch = roleStats.runs / per;
    const keeper = p.career.st >= 2 || (p.leagueOnly && lg.st >= 2) || KEEPERS.includes(p.short);
    let role = 'BAT';
    if (keeper) role = 'WK';
    else if (bowlPerMatch >= 9 && runsPerMatch >= 9) role = 'AR';
    else if (bowlPerMatch >= 9) role = 'BOWL';
    else if (bowlPerMatch >= 4 && runsPerMatch >= 12) role = 'AR';
    // Pace or spin: spinners bowl most of their overs in the middle (overs 7-15).
    const bt = p.career.bb >= 60 ? p.career : lg && lg.bb >= 60 ? lg : null;
    const bowlType = bt ? (SPINNERS.includes(p.short) || bt.mid / bt.bb >= 0.6 ? 'SPIN' : 'PACE') : null;
    const pack = s => ({ m: s.m, inn: s.inn, runs: s.runs, balls: s.balls, outs: s.outs, bb: s.bb, rc: s.rc, wk: s.wk });
    const name = w.name && !/^Q\d+$/.test(w.name) ? w.name : p.short;
    const img = w.img ? w.img.replace(/^http:/, 'https:') + '?width=240' : (w.thumb ?? '');
    const e = listById.get(p.id);
    // On the official list: its name, role, bowling style, country and status win.
    const official = e ? {
      name: e.name, role: e.role, country: e.country === 'India' ? 'IND' : e.country,
      overseas: e.country !== 'India', capped: e.capped,
      bowlType: e.bowling ? (/spin|slow/i.test(e.bowling) ? 'SPIN' : 'PACE') : bowlType,
      auction: { sr: e.sr, setNo: e.setNo, set: e.set, base: e.base, team2025: e.team2025 },
    } : {};
    return {
      id: p.id, name, short: p.short, role,
      country: nation === 'India' ? 'IND' : nation,
      overseas: nation !== 'India', capped: Boolean(capCountry),
      // Current team = the one he played for in 2026; a team from years ago (e.g. Mavi, KKR 2022) doesn't count.
      team: !p.listOnly && p.lastSeason === '2026' ? p.lastTeam : null, img, bowlType,
      career: pack(p.career), recent: pack(recent),
      ...(p.career.m < 8 && T20I.get(p.id)?.m >= 5 ? { t20i: pack(T20I.get(p.id)) } : {}),
      ...(p.career.m < 8 && !(T20I.get(p.id)?.m >= 5) && lg?.m >= 8 ? { league: pack(lg) } : {}),
      comps: [
        ...['2024', '2025', '2026'].filter(y => p.seasons[y]?.m).map(y => ({ name: `IPL ${y}`, ...pack(p.seasons[y]) })),
        ...(p.career.m ? [{ name: 'IPL career', ...pack(p.career) }] : []),
        ...(WC.get(p.id)?.m ? [{ name: 'T20 World Cup', ...pack(WC.get(p.id)) }] : []),
        ...(T20I.get(p.id)?.m ? [{ name: 'T20 internationals', ...pack(T20I.get(p.id)) }] : []),
        ...LEAGUES.filter(c => BY_LEAGUE.get(`${c}|${p.id}`)?.m).map(c => ({ name: LEAGUE_NAME[c], ...pack(BY_LEAGUE.get(`${c}|${p.id}`)) })),
      ],
      ...official,
    };
  });
  // Still no photo: search Wikimedia Commons for a file named after the player (free licences only).
  const strip = x => x.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, ' ');
  const noPhoto = out.filter(p => !p.img);
  const cacheFile = path.join(CACHE, 'commons-photos.json');
  const found = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (const p of noPhoto) {
    if (p.id in found) { if (found[p.id]) p.img = found[p.id]; continue; }
    const words = strip(p.name).split(' ').filter(w => w.length > 1);
    if (words.length < 2) continue;
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8' +
      '&prop=imageinfo&iiprop=url|mime&iiurlwidth=240&gsrsearch=' + encodeURIComponent(`"${p.name}" cricket`);
    try {
      await sleep(1000); // stay well inside Wikimedia's rate limits
      let res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 429) { await sleep(15000); res = await fetch(url, { headers: { 'User-Agent': UA } }); }
      if (!res.ok) continue;
      const pages = Object.values((await res.json()).query?.pages ?? {}).sort((a, b) => a.index - b.index);
      const hit = pages.find(pg => {
        const t = strip(pg.title);
        const info = pg.imageinfo?.[0];
        return info && /image\/(jpeg|png|webp)/.test(info.mime) && words.every(w => t.includes(w));
      });
      if (hit) p.img = hit.imageinfo[0].thumburl;
      found[p.id] = p.img || '';
      fs.writeFileSync(cacheFile, JSON.stringify(found));
    } catch { /* skip */ }
  }
  console.log(`commons search found ${noPhoto.filter(p => p.img).length} more photos`);

  // Openly licensed photos found by fetch-open-photos.mjs (Openverse), with credits.
  const openFile = path.join(ROOT, 'scripts/data/open-photos.json');
  if (fs.existsSync(openFile)) {
    const open = JSON.parse(fs.readFileSync(openFile, 'utf8'));
    for (const p of out) if (!p.img && open[p.id]) { p.img = open[p.id].url; p.imgCredit = open[p.id].credit; }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  const withImg = out.filter(p => p.img).length;
  console.log(`wrote ${out.length} players (${withImg} with photos) to ${path.relative(ROOT, OUT)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
