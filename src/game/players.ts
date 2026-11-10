import raw from '../data/players.json';
import type { TeamId } from '../data/teams';
import { RULES } from './rules';

export type Role = 'BAT' | 'WK' | 'AR' | 'BOWL';

interface RawStats { m: number; inn: number; runs: number; balls: number; outs: number; bb: number; rc: number; wk: number }
interface RawPlayer {
  id: string; name: string; short: string; role: Role; country: string;
  overseas: boolean; capped: boolean; team: TeamId | null; img: string; imgCredit?: string; bowlType: 'PACE' | 'SPIN' | null;
  career: RawStats; recent: RawStats; t20i?: RawStats; league?: RawStats;
  comps?: (RawStats & { name: string })[];
  auction?: Auction2026;
}

/** Entry on the official TATA IPL 2026 auction list. */
export interface Auction2026 { sr: number; setNo: number; set: string; base: number; team2025: TeamId | null }

export interface Player {
  id: string;
  name: string;
  role: Role;
  country: string;
  overseas: boolean;
  capped: boolean;
  lastTeam: TeamId | null;
  img: string;
  imgCredit?: string; // photographer + licence for openly licensed photos
  stats: { matches: number; runs: number; avg: number; sr: number; wickets: number; econ: number };
  statsFrom: 'IPL' | 'T20I' | 'League' | null; // null = no record (new domestic player)
  /** Stats by competition: recent IPL seasons, T20 World Cup, T20Is, each franchise league. */
  comps: CompStats[];
  auction?: Auction2026;
  rating: number;    // 0–100, from stats and form
  star: number;      // 0–100 star power: experience, class and name recognition
  value: number;     // fair price in lakhs (stats + star power)
  base: number;      // base price in lakhs
  bowlType: 'PACE' | 'SPIN' | null;
  set: string;       // set code, as in the IPL auction list: M1, BA1, UFA2…
  setName: string;   // e.g. "Capped batters 1"
  setOrder: number;
}

export interface CompStats { name: string; m: number; runs: number; sr: number; avg: number; wickets: number; econ: number }

export const ROLE_LABEL: Record<Role, string> = { BAT: 'Batter', WK: 'Wicket-keeper', AR: 'All-rounder', BOWL: 'Bowler' };

const round1 = (n: number) => Math.round(n * 10) / 10;

// Name recognition on top of the numbers: the biggest draws in the IPL.
const LEGENDS = ['MS Dhoni', 'Virat Kohli', 'Rohit Sharma', 'Jasprit Bumrah'];
const STARS = ['Hardik Pandya', 'Suryakumar Yadav', 'Shubman Gill', 'Rishabh Pant', 'Ravindra Jadeja', 'KL Rahul',
  'Rashid Khan', 'Sunil Narine', 'Andre Russell', 'Shreyas Iyer', 'Sanju Samson', 'Yashasvi Jaiswal', 'Heinrich Klaasen',
  'Travis Head', 'Jos Buttler', 'Pat Cummins', 'Mitchell Starc', 'Abhishek Sharma', 'Ruturaj Gaikwad', 'Yuzvendra Chahal',
  'Kuldeep Yadav', 'Mohammed Shami', 'Arshdeep Singh', 'Axar Patel', 'Glenn Maxwell', 'Faf du Plessis', 'David Miller',
  'Quinton De Kock', 'Nicolas Pooran', 'Varun Chakravarthy', 'Cameron Green', 'Mitchell Marsh', 'Liam Livingstone',
  'Ravichandran Ashwin', 'Bhuvneshwar Kumar', 'Mohammed Siraj', 'Trent Boult', 'Kagiso Rabada'];

/** Star power 0–100: IPL experience, class (rating, international status) and name recognition. */
function starPower(name: string, iplMatches: number, rating: number, capped: boolean) {
  const experience = 40 * Math.min(1, iplMatches / 200);
  const cls = 0.5 * Math.max(0, rating - 60) + (capped ? 8 : 0);
  const fame = LEGENDS.includes(name) ? 35 : STARS.includes(name) ? 20 : 0;
  return Math.max(0, Math.min(100, Math.round(experience + cls + fame)));
}

export const starLabel = (star: number) => (star >= 80 ? 'Legend' : star >= 60 ? 'Star' : null);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function batScore(s: RawStats) {
  if (s.inn < 3 || s.balls < 30) return 30;
  const perInn = s.runs / s.inn;
  const sr = (s.runs / s.balls) * 100;
  return clamp(28 + perInn * (sr / 130) * 1.55, 0, 99);
}

function bowlScore(s: RawStats) {
  if (s.bb < 60) return 30;
  const perMatch = s.wk / Math.max(1, s.bb / 24); // wickets per 4 overs
  const econ = (s.rc / s.bb) * 6;
  return clamp(30 + (perMatch * 20 + (9.6 - econ) * 8) * 1.45, 0, 99);
}

function roleScore(role: Role, s: RawStats) {
  const bat = batScore(s), bowl = bowlScore(s);
  if (role === 'AR') return clamp(Math.max(bat, bowl) + 0.35 * (Math.min(bat, bowl) - 30), 0, 99);
  if (role === 'BOWL') return bowl;
  return role === 'WK' ? bat + 2 : bat;
}

/** Rating 0–100: recent form weighted over career, pulled to the middle for small samples. */
export function rate(role: Role, career: RawStats, recent: RawStats, capped: boolean) {
  const raw = recent.m >= 6 ? 0.65 * roleScore(role, recent) + 0.35 * roleScore(role, career) : roleScore(role, career);
  const shrink = career.m / (career.m + 10);
  return clamp(Math.round(50 + (raw - 50) * shrink + (capped ? 3 : 0)), 35, 97);
}

/** Fair price in lakhs from rating: ~base at 50, ~₹6 Cr at 75, ₹14 Cr+ at 90. */
export function fairValue(rating: number, marquee = false) {
  const x = clamp((rating - 45) / 50, 0, 1.2);
  const cr = 0.3 + 17 * Math.pow(x, 2.3);
  return Math.round(cr * 100 * (marquee ? 1.15 : 1) / 5) * 5;
}

function basePrice(rating: number) {
  if (rating >= 80) return 200;
  if (rating >= 74) return 150;
  if (rating >= 68) return 100;
  if (rating >= 62) return 75;
  return 30;
}

/** Snap any price to the fixed base prices (₹30 L, 75 L, 1 Cr, 1.5 Cr, 2 Cr); ties go up. */
export function snapBase(lakhs: number): number {
  return RULES.basePrices.reduce((best, b) => (Math.abs(b - lakhs) < Math.abs(best - lakhs) || (Math.abs(b - lakhs) === Math.abs(best - lakhs) && b > best) ? b : best), RULES.basePrices[0] as number);
}

/** Rating for players with no record, from the official base price (the BCCI's own grading). */
function ratingFromBase(base: number, key: string) {
  const r = base >= 200 ? 78 : base >= 150 ? 74 : base >= 125 ? 72 : base >= 100 ? 69 : base >= 75 ? 64 : base >= 50 ? 58 : base >= 40 ? 55 : 49;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return r + (h % 9) - 4; // spread players of the same price a little
}

function build(): Player[] {
  const list: Player[] = (raw as RawPlayer[]).map(p => {
    const useT20I = p.career.m < 8 && p.t20i;
    const useLeague = !useT20I && p.career.m < 8 && p.league;
    const c = useT20I ? p.t20i! : useLeague ? p.league! : p.career;
    const statsFrom = useT20I ? 'T20I' as const : useLeague ? 'League' as const : p.career.m > 0 ? 'IPL' as const : null;
    let rating = statsFrom === null ? ratingFromBase(p.auction?.base ?? 30, p.id)
      : useT20I ? rate(p.role, c, c, p.capped) - 3
      : useLeague ? Math.min(78, rate(p.role, c, c, p.capped) - 10)   // franchise leagues are a clear step below the IPL
      : rate(p.role, c, p.recent, p.capped);
    // Thin record: lean on the official base price too.
    if (p.auction && c.m < 15) rating = Math.round((rating + ratingFromBase(p.auction.base, p.id)) / 2);
    return {
      id: p.id, name: p.name, role: p.role, country: p.country, overseas: p.overseas,
      capped: p.capped, lastTeam: p.team, img: p.img, imgCredit: p.imgCredit, statsFrom,
      comps: (p.comps ?? []).map(c => ({
        name: c.name, m: c.m, runs: c.runs, wickets: c.wk,
        sr: c.balls ? round1((c.runs / c.balls) * 100) : 0,
        avg: c.outs ? round1(c.runs / c.outs) : c.runs,
        econ: c.bb ? round1((c.rc / c.bb) * 6) : 0,
      })), auction: p.auction,
      stats: {
        matches: c.m, runs: c.runs,
        avg: c.outs ? round1(c.runs / c.outs) : c.runs,
        sr: c.balls ? round1((c.runs / c.balls) * 100) : 0,
        wickets: c.wk,
        econ: c.bb ? round1((c.rc / c.bb) * 6) : 0,
      },
      rating, star: starPower(p.name, p.career.m, rating, p.capped), value: 0, base: snapBase(p.auction?.base ?? (useLeague ? Math.min(100, basePrice(rating)) : basePrice(rating))), bowlType: p.bowlType, set: '', setName: '', setOrder: 0,
    };
  });

  const sets = assignSets(list);
  for (const p of list) Object.assign(p, { set: sets[p.id].code, setName: sets[p.id].name, setOrder: sets[p.id].order });
  // Big names cost more than their numbers alone: up to +35% for star power.
  for (const p of list) {
    const premium = 1 + Math.min(0.35, Math.max(0, p.star - 40) / 110);
    // A big name never goes cheap, even when his recent numbers are modest (think Dhoni).
    const nameFloor = p.star >= 60 ? (p.star - 50) * 35 : 0; // lakhs: star 85 → ₹12.25 Cr
    p.value = Math.round(Math.max(fairValue(p.rating, p.setOrder <= 1) * premium, nameFloor) / 5) * 5;
  }
  return list;
}

export interface SetInfo { code: string; name: string; order: number }

/** Marquee sets of the IPL 2025 mega auction (Jeddah, Nov 2024): M1 then M2. */
const MARQUEE_2025 = [
  'Jos Buttler', 'Shreyas Iyer', 'Rishabh Pant', 'Kagiso Rabada', 'Arshdeep Singh', 'Mitchell Starc',
  'Yuzvendra Chahal', 'Liam Livingstone', 'David Miller', 'KL Rahul', 'Mohammed Shami', 'Mohammed Siraj',
];

/**
 * Sets follow the IPL 2026 auction list, built from whoever is in the auction pool:
 * marquee sets M1 and M2 (6 each) first, then capped sets (BA, AL, WK, FA, SP) round 1,
 * uncapped sets (UBA, UAL, UWK, UFA, USP) round 1, then round 2 of each, and so on.
 */
export function assignSets(pool: Player[]): Record<string, SetInfo> {
  const out: Record<string, SetInfo> = {};
  const list = [...pool].sort((a, b) => b.rating - a.rating);
  // Marquee: the official IPL 2025 mega auction marquee players first (when they're in the pool),
  // then the biggest remaining names by star power + rating together, not stats alone.
  const byName = new Map(list.map(p => [p.name, p]));
  const official = MARQUEE_2025.map(n => byName.get(n)).filter((p): p is Player => Boolean(p));
  const others = list.filter(p => p.capped && !official.includes(p) && p.star >= 55)
    .sort((a, b) => (b.star + b.rating) - (a.star + a.rating));
  [...official, ...others].slice(0, 12).forEach((p, i) => {
    const n = i < 6 ? 1 : 2;
    out[p.id] = { code: `M${n}`, name: `Marquee Set ${n}`, order: n - 1 };
  });
  const order = ['BA', 'AL', 'WK', 'FA', 'SP', 'UBA', 'UAL', 'UWK', 'UFA', 'USP'];
  const kind: Record<string, string> = { BA: 'Batters', AL: 'All-rounders', WK: 'Wicket-keepers', FA: 'Fast Bowlers', SP: 'Spinners' };
  const code = (p: Player) => {
    const c = p.role === 'BAT' ? 'BA' : p.role === 'AR' ? 'AL' : p.role === 'WK' ? 'WK' : p.bowlType === 'SPIN' ? 'SP' : 'FA';
    return p.capped ? c : 'U' + c;
  };
  const rest = list.filter(p => !out[p.id]);
  for (const c of order) {
    const size = c.startsWith('U') ? 10 : 8;
    const group = rest.filter(p => code(p) === c);
    const full = Math.max(1, Math.floor(group.length / size)); // leftovers join the last full set
    group.forEach((p, i) => {
      const n = Math.min(Math.floor(i / size) + 1, full);
      out[p.id] = {
        code: `${c}${n}`,
        name: `${c.startsWith('U') ? 'Uncapped' : 'Capped'} ${kind[c.replace(/^U/, '')]} Set ${n}`,
        order: 2 + (n - 1) * order.length + order.indexOf(c),
      };
    });
  }
  return out;
}

export const PLAYERS = build();
export const playerById: Record<string, Player> = Object.fromEntries(PLAYERS.map(p => [p.id, p]));

/** Auction order: set by set; inside a set the order is shuffled, as in the real auction. */
export function auctionOrder(ids: string[], sets: Record<string, SetInfo>, rand: () => number): string[] {
  return ids
    .map(id => ({ id, o: sets[id].order, k: rand() }))
    .sort((a, b) => a.o - b.o || a.k - b.k)
    .map(x => x.id);
}

export function roleLabel(p: Player) {
  if (p.role !== 'BOWL') return ROLE_LABEL[p.role];
  return p.bowlType === 'SPIN' ? 'Spinner' : 'Fast bowler';
}
