// Bot managers. Each bot sets a top price per player from rating, squad needs and money left,
// then bids while the current bid is below it. The level changes accuracy and planning.

import type { TeamId } from '../data/teams';
import { TEAM_IDS } from '../data/teams';
import { RULES, bidAtOrBelow, nextBid, type BotLevel } from './rules';
import { playerById, type Player, type Role } from './players';
import { hash01 } from './rng';
import { retainable, retentionPlan, retentionError, bidBlock, overseasCount, reserveNeeded, shownTeam } from './engine';
import type { GameState, TeamState, RtmOffer } from './engine';

interface LevelCfg { noise: number; needWeight: number; slotCap: number; marqueeCap: number; skip: number; push: number }
const LEVEL: Record<BotLevel, LevelCfg> = {
  easy: { noise: 0.4, needWeight: 0.3, slotCap: 5, marqueeCap: 6, skip: 0.3, push: 0 },
  medium: { noise: 0.15, needWeight: 1, slotCap: 2.6, marqueeCap: 3.2, skip: 0.05, push: 0.35 },
  hard: { noise: 0.05, needWeight: 1, slotCap: 2.4, marqueeCap: 3.8, skip: 0, push: 0.5 },
};
export const TARGET: Record<Role, number> = { BAT: 6, WK: 2, AR: 4, BOWL: 7 };
const BOT_SQUAD = 22;

function need(t: TeamState, p: Player) {
  const count = t.squad.filter(e => playerById[e.id].role === p.role).length;
  if (p.role === 'WK' && count === 0 && t.squad.length >= 8) return 1.4;
  const gap = TARGET[p.role] - count;
  if (gap > 0) return 1 + 0.06 * gap;
  return t.squad.length >= RULES.squadMin ? 0.55 : 0.8;
}

/** The most this bot will pay for `p` right now, in lakhs (0 = not interested). */
/**
 * IPL experience: proven IPL players are worth more, players with little or no IPL record less.
 * Recent seasons count too: a regular in 2025 and 2026 gets a little extra.
 */
export function experienceFactor(p: Player) {
  if (p.statsFrom === null) return 0.55;           // new face: no IPL, international or league record
  if (p.statsFrom === 'League') return 0.6;        // franchise leagues only
  if (p.statsFrom === 'T20I') return 0.7;          // internationals, few IPL games
  const m = p.stats.matches;
  const recent = p.comps.filter(c => c.name === 'IPL 2025' || c.name === 'IPL 2026').reduce((a, c) => a + c.m, 0);
  const base = m >= 50 ? 1.1 : m >= 20 ? 1 : m >= 8 ? 0.9 : 0.75;
  return base + (recent >= 16 ? 0.05 : 0);
}

/** How much a player matters to his former team: 0 (fringe) to 1 (key player). */
function importance(p: Player) {
  return Math.max(0, Math.min(1, Math.max((p.rating - 60) / 30, (p.star - 40) / 50)));
}

/** Loyalty: a team prefers its own former players, more so the important ones. */
function loyalty(s: GameState, team: TeamId, p: Player) {
  if (shownTeam(s, p) !== team) return { bonus: 0, chance: 0 };
  const imp = importance(p);
  const strength = s.settings.level === 'hard' ? 1 : s.settings.level === 'medium' ? 0.8 : 0.5;
  return {
    bonus: (0.05 + 0.3 * imp) * strength,      // extra on top of fair price: ~+5% fringe, ~+35% key player
    chance: (0.35 + 0.6 * imp) * strength,     // how likely the former team wants him back
  };
}

export function botMaxBid(s: GameState, team: TeamId, p: Player): number {
  const t = s.teams[team];
  const cfg = LEVEL[s.settings.level];
  const key = `${s.settings.seed}:${team}:${p.id}`;
  if (t.squad.length >= RULES.squadMax) return 0;
  if (p.overseas && overseasCount(t) >= RULES.overseasMax) return 0;
  if (hash01(key + ':skip') < cfg.skip) return 0;

  let n = need(t, p);
  if (p.overseas && overseasCount(t) >= 6) n *= 0.75;
  n = 1 + (n - 1) * cfg.needWeight;
  let max = p.value * n * (1 + cfg.noise * (2 * hash01(key) - 1));
  max *= 1 + loyalty(s, team, p).bonus;
  max *= experienceFactor(p);
  // Easy bots hunt bargains: they rarely pay far above a player's base price.
  if (s.settings.level === 'easy') max = Math.min(max * 0.7, p.base * (p.rating >= 80 ? 6 : p.rating >= 70 ? 3.5 : 2));
  // Mini auctions: few slots and big purses chase the few quality players, so prices run hot.
  if (s.settings.mode === 'mini') max *= p.rating >= 80 ? 2.6 : p.rating >= 72 ? 1.8 : p.rating >= 64 ? 1.25 : 1;

  const spendable = t.purse - reserveNeeded(t);
  const perSlot = spendable / Math.max(1, BOT_SQUAD - t.squad.length);
  const cap = perSlot * (p.rating >= 85 ? cfg.marqueeCap : cfg.slotCap);
  max = Math.min(max, cap, spendable);
  // A new face is a gamble: never more than twice his base price.
  if (p.statsFrom === null) max = Math.min(max, p.base * 2);
  // Unproven in the IPL (internationals or leagues only): at most four times base.
  if (p.statsFrom === 'T20I' || p.statsFrom === 'League') max = Math.min(max, p.base * 4);

  // Fast round: a short squad will take anyone useful near base price.
  if (s.round === 2 && t.squad.length < RULES.squadMin) max = Math.max(max, Math.min(spendable, p.base * 1.5));
  return Math.max(0, Math.floor(max));
}

/** Lots still to come, and how many players the bots still need to reach 18. */
function squeeze(s: GameState) {
  const left = s.queue.length - s.qi - 1;
  const short = TEAM_IDS.reduce((a, id) => a + (s.teams[id].human || s.teams[id].out ? 0 : Math.max(0, RULES.squadMin - s.teams[id].squad.length)), 0);
  return { left, short };
}

/**
 * Does this bot want to enter the bidding at all? Real teams leave most players alone:
 * they chase roles they're short of, stars, and anyone useful once time runs out.
 */
export function interested(s: GameState, team: TeamId, p: Player): boolean {
  const t = s.teams[team];
  const level = s.settings.level;
  if (t.squad.length >= RULES.squadMax) return false;
  if (p.overseas && overseasCount(t) >= RULES.overseasMax) return false;
  if (t.squad.length < RULES.squadMin) {
    const { left, short } = squeeze(s);
    if (s.round === 2 || short * 1.3 >= left) return true; // running out of players: take anyone useful
  }
  const count = t.squad.filter(e => playerById[e.id].role === p.role).length;
  const gap = TARGET[p.role] - count;
  let pr = gap > 0 ? 0.65 : gap === 0 ? 0.25 : 0.08;
  if (p.role === 'WK' && count === 0) pr = 0.9;
  if (p.rating >= 85) pr = Math.max(pr, 0.8);
  if (t.squad.length >= RULES.squadMin) pr *= 0.5;
  if (p.overseas && overseasCount(t) >= 6) pr *= 0.5;
  // Once a team has a core, it ignores clearly weaker players.
  const top = t.squad.map(e => playerById[e.id].rating).sort((a, b) => b - a).slice(0, 11);
  if (top.length >= 11 && p.rating < top.reduce((a, b) => a + b, 0) / 11 - 12) pr *= 0.4;
  if (level === 'easy') pr *= 0.55;                      // casual: chases fewer players, leaves plenty unsold
  if (level === 'hard' && gap <= 0) pr *= 0.6;          // disciplined: leaves what it doesn't need
  // Teams back proven IPL players. Unknown domestic names mostly go unsold unless a team needs bodies.
  const experience = p.statsFrom === 'IPL' ? (p.stats.matches >= 10 ? 1 : 0.7) : p.statsFrom === 'T20I' ? 0.6 : p.statsFrom === 'League' ? 0.5 : 0.18;
  pr *= experience;
  pr = Math.max(pr, loyalty(s, team, p).chance);       // former team wants him back, by importance
  return hash01(`${s.settings.seed}:${team}:${p.id}:int`) < pr;
}

/** Bots in the fight for this player: 2–4 of the interested ones (one more for stars). */
export function contenders(s: GameState, p: Player): TeamId[] {
  const seed = s.settings.seed;
  const k = 2 + Math.floor(hash01(`${seed}:${p.id}:k`) * 3) + (p.rating >= 85 ? 1 : 0);
  const former = shownTeam(s, p);
  return TEAM_IDS
    .filter(id => !s.teams[id].human && !s.teams[id].out && interested(s, id, p))
    .sort((a, b) => (b === former ? 1 : 0) - (a === former ? 1 : 0) || hash01(`${seed}:${a}:${p.id}:o`) - hash01(`${seed}:${b}:${p.id}:o`))
    .slice(0, k);
}

/** Choose which bot bids next, or null if none will. `instant` ignores the human (Skip). */
export function pickBidder(s: GameState, r: number, instant = false): TeamId | null {
  const lot = s.lot;
  if (!lot) return null;
  const p = playerById[lot.playerId];
  const amount = nextBid(lot.bid, p.base);
  const cfg = LEVEL[s.settings.level];
  const humanLeads = !instant && lot.leader !== null && s.teams[lot.leader].human;
  const willing: { team: TeamId; w: number }[] = [];
  for (const id of contenders(s, p)) {
    const t = s.teams[id];
    if (id === lot.leader || bidBlock(t, p, amount)) continue;
    let max = botMaxBid(s, id, p);
    // Push the price on a human's target, but drop out before passing fair value.
    if (humanLeads && p.rating >= 72 && hash01(`${s.settings.seed}:${id}:${p.id}:push`) < cfg.push) {
      max = Math.max(max, Math.min(p.value * 0.95, (t.purse - reserveNeeded(t)) / 3));
    }
    if (max >= amount) willing.push({ team: id, w: max - amount + 10 });
  }
  if (!willing.length) return null;
  let x = r * willing.reduce((a, b) => a + b.w, 0);
  for (const c of willing) { x -= c.w; if (x <= 0) return c.team; }
  return willing[willing.length - 1].team;
}

/** Mega retention choice for a bot team. */
export function botRetain(s: GameState, team: TeamId): string[] {
  const level = s.settings.level;
  const options = retainable(team);
  const pick: string[] = [];
  const tryAdd = (id: string) => {
    const next = [...pick, id];
    if (!retentionError(next)) pick.push(id);
  };
  if (level === 'easy') {
    const k = 2 + Math.floor(hash01(`${s.settings.seed}:${team}:k`) * 3);
    const top = options.slice(0, 7).sort((a, b) => hash01(a.id + team) - hash01(b.id + team));
    for (const p of top) if (pick.length < k) tryAdd(p.id);
    return pick;
  }
  const limit = level === 'hard' ? RULES.maxRetentions : 4;
  const tolerance = level === 'hard' ? 0.85 : 0.9;
  for (const p of [...options].sort((a, b) => b.value - a.value)) {
    if (pick.length >= limit) break;
    const plan = retentionPlan([...pick, p.id]);
    if (p.value >= plan[plan.length - 1].cost * tolerance) tryAdd(p.id);
  }
  return pick;
}

/** Holder decides whether to use an RTM card at this price. */
export function botWantsRtm(s: GameState, o: RtmOffer): boolean {
  const p = playerById[o.playerId];
  const max = botMaxBid(s, o.holder, p);
  const level = s.settings.level;
  if (level === 'easy') return hash01(`${s.settings.seed}:${p.id}:rtm`) < 0.3 && max >= o.price * 0.8;
  return max >= o.price * (level === 'hard' ? 1 : 0.95);
}

/** Buyer's final raise after an RTM match (null = no raise). */
export function botRtmRaise(s: GameState, o: RtmOffer): number | null {
  const p = playerById[o.playerId];
  const max = botMaxBid(s, o.buyer, p);
  const next = nextBid(o.price, p.base);
  if (max < next || bidBlock(s.teams[o.buyer], p, next)) return null;
  const raise = bidAtOrBelow(Math.min(max, s.teams[o.buyer].purse - reserveNeeded(s.teams[o.buyer])), p.base);
  return raise > o.price ? raise : null;
}
