// Auction engine: plain data in, plain data out. Functions mutate the state passed in;
// callers clone first (see useGame). No React here, so it can run in a browser or on a host.

import { TEAM_IDS, type TeamId } from '../data/teams';
import { RULES, nextBid, type AuctionMode, type BotLevel } from './rules';
import { PLAYERS, playerById, auctionOrder, assignSets, type Player, type SetInfo } from './players';
import { rng } from './rng';
import { botMaxBid, botRetain, botWantsRtm, botRtmRaise, pickBidder } from './bots';

export type Acquired = 'retained' | 'bought' | 'rtm';
export interface SquadEntry { id: string; price: number; how: Acquired }
export interface TeamState { id: TeamId; human: boolean; purse: number; squad: SquadEntry[]; rtm: number }
export interface Lot {
  playerId: string;
  bid: number | null;
  leader: TeamId | null;
  endsAt: number;
  plan: { team: TeamId; at: number } | null; // next bot bid
}
export interface RtmOffer {
  playerId: string; holder: TeamId; buyer: TeamId; price: number;
  stage: 'match' | 'raise' | 'final'; // who decides: holder, buyer, holder
  at: number;                          // when a bot decides
}
export interface Result { status: 'sold' | 'unsold'; team?: TeamId; price?: number; how?: Acquired }
export interface Settings {
  mode: AuctionMode; level: BotLevel; team: TeamId; timer: number; length: 'quick' | 'full'; seed: number;
  /** Friends room: every team played by a person (the host's own team included). */
  humans?: TeamId[];
  /** Friends room: the name of the person playing each team. */
  names?: Partial<Record<TeamId, string>>;
}
export interface GameState {
  v: 2;
  settings: Settings;
  phase: 'retention' | 'auction' | 'done';
  teams: Record<TeamId, TeamState>;
  queue: string[];
  qi: number;
  round: 1 | 2;
  lot: Lot | null;
  rtm: RtmOffer | null;
  paused: { left: number } | null;
  results: Record<string, Result>;
  log: string[];        // newest first
  rand: number;         // rng state
  lastEvent: { playerId: string; result: Result } | null;
  hold?: number | null; // after a result, the next player opens at this time
  /** Set being auctioned; a new set is announced before its first player. */
  currentSet?: string;
  sets?: Record<string, SetInfo>; // set of every player in this auction's pool
  released?: string[];             // mini: players you released, auctioned first
  ready?: TeamId[];                // teams whose person has confirmed retentions or releases
  intro?: SetIntro | null;
}
export interface SetIntro { set: string; name: string; players: string[] }

const SOLD_HOLD_MS = 5500; // sold card stays for the whole 5 s team song
const SET_INTRO_MS = 3500;
const UNSOLD_HOLD_MS = 1500;
const BOT_DELAY: Record<BotLevel, [number, number]> = { easy: [1500, 4000], medium: [1000, 3000], hard: [600, 2500] };

// ---------- helpers ----------

function random(s: GameState) {
  const r = rng(s.rand)();
  s.rand = (s.rand + 0x9e3779b9) >>> 0;
  return r;
}
const fmt = (l: number) => (l >= 100 ? `₹${+(l / 100).toFixed(2)} Cr` : `₹${l} L`);
function log(s: GameState, text: string) { s.log.unshift(text); s.log.length = Math.min(s.log.length, 80); }

export const overseasCount = (t: TeamState) => t.squad.filter(e => playerById[e.id].overseas).length;

/** Purse a team must keep to reach the 18-player minimum at the lowest base price. */
export function reserveNeeded(t: TeamState, afterBuying = 1) {
  return Math.max(0, RULES.squadMin - t.squad.length - afterBuying) * RULES.minBase;
}

/** Why `team` can't pay `amount` for `p`, or null if it can. */
export function bidBlock(t: TeamState, p: Player, amount: number): string | null {
  if (t.squad.length >= RULES.squadMax) return `Squad full (${RULES.squadMax}/${RULES.squadMax})`;
  if (p.overseas && overseasCount(t) >= RULES.overseasMax) return `Overseas slots full (${RULES.overseasMax}/${RULES.overseasMax})`;
  if (amount > t.purse) return `Need ${fmt(amount - t.purse)} more`;
  if (t.purse - amount < reserveNeeded(t)) return `Keep ${fmt(reserveNeeded(t))} to reach 18 players`;
  return null;
}

const SET_KIND: Record<string, string> = { BA: 'Batters', AL: 'All-rounders', WK: 'Wicket-keepers', FA: 'Fast Bowlers', SP: 'Spinners' };

/** Set as printed on the official list, e.g. UFA3 → "Uncapped Fast Bowlers Set 3". */
function officialSet(p: Player): SetInfo {
  const a = p.auction!;
  const m = /^(U?)([A-Z]{2})(\d+)$/.exec(a.set);
  const name = m ? `${m[1] ? 'Uncapped' : 'Capped'} ${SET_KIND[m[2]] ?? m[2]} Set ${m[3]}` : a.set;
  return { code: a.set, name: `Set ${a.setNo} · ${name}`, order: a.setNo };
}

/** The set a player is in for this auction. */
export function setOf(s: GameState, id: string): SetInfo {
  const p = playerById[id];
  return s.sets?.[id] ?? { code: p.set, name: p.setName, order: p.setOrder };
}

/** Team shown next to a player. Mini (the 2026 auction): his 2025 team, so the real result isn't spoiled. */
export function shownTeam(s: GameState, p: Player): TeamId | null {
  return s.settings.mode === 'mini' && p.auction ? p.auction.team2025 : p.lastTeam;
}

export const currentPlayer = (s: GameState) => (s.lot ? playerById[s.lot.playerId] : null);
export const nextAmount = (s: GameState) => (s.lot ? nextBid(s.lot.bid, playerById[s.lot.playerId].base) : 0);

// ---------- setup ----------

export function createGame(settings: Settings): GameState {
  const teams = {} as Record<TeamId, TeamState>;
  const humans = new Set([settings.team, ...(settings.humans ?? [])]);
  for (const id of TEAM_IDS) teams[id] = { id, human: humans.has(id), purse: RULES.megaPurse, squad: [], rtm: 0 };
  const s: GameState = {
    v: 2, settings, phase: 'retention', teams, queue: [], qi: 0, round: 1, lot: null, rtm: null,
    paused: null, results: {}, log: [], rand: settings.seed >>> 0, lastEvent: null,
  };
  // Bots pick their own retentions now; every person (host and friends) picks on their own screen.
  s.ready = [];
  if (settings.mode === 'mega') {
    for (const id of TEAM_IDS) if (!humans.has(id)) applyRetention(s, id, botRetain(s, id));
  } else {
    setupMini(s);
  }
  return s;
}

/** Previous-season players a team can retain in a mega auction. */
export const retainable = (team: TeamId) =>
  PLAYERS.filter(p => p.lastTeam === team).sort((a, b) => b.rating - a.rating);

export function retentionPlan(ids: string[]) {
  let capped = 0;
  return ids.map(id => {
    const p = playerById[id];
    const cost = p.capped ? RULES.cappedSlabs[capped++] ?? 1400 : RULES.uncappedSlab;
    return { id, cost };
  });
}

export function retentionError(ids: string[]): string | null {
  const capped = ids.filter(id => playerById[id].capped).length;
  if (ids.length > RULES.maxRetentions) return `Max ${RULES.maxRetentions} players`;
  if (capped > RULES.maxCappedRetentions) return `Max ${RULES.maxCappedRetentions} capped players`;
  if (ids.length - capped > RULES.maxUncappedRetentions) return `Max ${RULES.maxUncappedRetentions} uncapped players`;
  return null;
}

export function applyRetention(s: GameState, team: TeamId, ids: string[]) {
  const t = s.teams[team];
  for (const { id, cost } of retentionPlan(ids)) {
    t.squad.push({ id, price: cost, how: 'retained' });
    t.purse -= cost;
    s.results[id] = { status: 'sold', team, price: cost, how: 'retained' };
  }
  t.rtm = RULES.maxRetentions - ids.length;
}

/**
 * Mini auction = the real IPL 2026 auction: each team keeps its squad (2026 players who were
 * not on the auction list) with its real remaining purse, and the official 350-player list goes
 * under the hammer in official order.
 */
function setupMini(s: GameState) {
  for (const id of TEAM_IDS) {
    const t = s.teams[id];
    let os = 0;
    for (const p of retainable(id)) {
      if (p.auction || t.squad.length >= RULES.squadMax - 1) continue;
      if (p.overseas && os >= RULES.overseasMax) continue;
      if (p.overseas) os++;
      const price = Math.max(p.base, Math.round(p.value * 0.8 / 5) * 5);
      t.squad.push({ id: p.id, price, how: 'retained' });
      s.results[p.id] = { status: 'sold', team: id, price, how: 'retained' };
    }
    t.purse = RULES.miniPurse2026[id];
  }
  // Your squad shows on the release screen first; the auction starts after that.
}

/** Mini auction: release players from your squad. Their salary returns to your purse and they go under the hammer first. */
export function releasePlayers(s: GameState, team: TeamId, ids: string[]) {
  const t = s.teams[team];
  for (const id of ids) {
    const i = t.squad.findIndex(e => e.id === id);
    if (i < 0) continue;
    t.purse += t.squad[i].price;
    t.squad.splice(i, 1);
    delete s.results[id];
  }
  s.released = [...(s.released ?? []), ...ids];
  if (ids.length) log(s, `${team} released ${ids.length} ${ids.length === 1 ? 'player' : 'players'}`);
}

/**
 * A person confirms their squad before the auction: retained players (mega) or released players (mini).
 * Checked here because friends send their choice over the network.
 */
export function confirmSquad(s: GameState, team: TeamId, ids: string[]): boolean {
  if (s.phase !== 'retention' || (s.ready ??= []).includes(team)) return false;
  const unique = [...new Set(ids)];
  if (s.settings.mode === 'mega') {
    const allowed = new Set(retainable(team).map(p => p.id));
    if (!unique.every(id => allowed.has(id) && !s.results[id]) || retentionError(unique)) return false;
    applyRetention(s, team, unique);
  } else {
    releasePlayers(s, team, unique.filter(id => s.teams[team].squad.some(e => e.id === id)));
  }
  s.ready.push(team);
  return true;
}

/** People who still have to confirm their squad. */
export const squadsPending = (s: GameState) =>
  s.phase === 'retention' ? TEAM_IDS.filter(id => s.teams[id].human && !(s.ready ?? []).includes(id)) : [];

/** Teams whose person left (or the host won't wait for): a bot decides for them. */
export function botConfirmSquad(s: GameState, team: TeamId) {
  if (s.phase !== 'retention' || (s.ready ??= []).includes(team)) return;
  if (s.settings.mode === 'mega') applyRetention(s, team, botRetain(s, team));
  s.ready.push(team);
}

/** Start the auction once every person has confirmed their squad. */
export function startWhenReady(s: GameState, now: number) {
  if (s.phase === 'retention' && squadsPending(s).length === 0) startAuction(s, now);
}

export function startAuction(s: GameState, now: number) {
  const r = rng(s.settings.seed ^ 0x51ed);
  if (s.settings.mode === 'mini') {
    // Official list, official sets, official order.
    let list = PLAYERS.filter(p => p.auction && !s.results[p.id]).sort((a, b) => a.auction!.sr - b.auction!.sr);
    if (s.settings.length === 'quick') list = list.slice(0, RULES.quickMiniSize);
    s.sets = Object.fromEntries(list.map(p => [p.id, officialSet(p)]));
    // Players you released come up first, as their own set.
    const released = (s.released ?? []).filter(id => !s.results[id]);
    for (const id of released) s.sets[id] = { code: 'RL', name: 'Released players', order: 0 };
    s.queue = [...released, ...list.map(p => p.id)];
  } else {
    let pool = PLAYERS.filter(p => !s.results[p.id]).map(p => p.id);
    if (s.settings.length === 'quick') {
      // Best players first, but keep enough Indian players for every team to reach 18.
      const ranked = pool.sort((a, b) => playerById[b].rating - playerById[a].rating);
      const overseas = ranked.filter(id => playerById[id].overseas).slice(0, RULES.quickOverseasMax);
      const indian = ranked.filter(id => !playerById[id].overseas).slice(0, RULES.quickPoolSize - overseas.length);
      pool = [...overseas, ...indian];
    }
    s.sets = assignSets(pool.map(id => playerById[id]));
    s.queue = auctionOrder(pool, s.sets, r);
  }
  s.qi = -1;
  s.phase = 'auction';
  log(s, s.settings.mode === 'mega' ? 'Mega auction started' : 'Mini auction started');
  openNext(s, now);
}

// ---------- lots ----------

function openNext(s: GameState, now: number) {
  s.lot = null;
  const allFull = TEAM_IDS.every(id => s.teams[id].squad.length >= RULES.squadMax);
  while (!allFull) {
    s.qi++;
    if (s.qi >= s.queue.length) {
      const unsold = s.queue.filter(id => s.results[id]?.status === 'unsold');
      if (s.round === 1 && unsold.length) {
        s.round = 2;
        s.queue = unsold;
        s.qi = -1;
        for (const id of unsold) {
          delete s.results[id];
          // Returning players form one group, not one "set" each.
          (s.sets ??= {})[id] = { code: 'AR', name: 'Accelerated round · unsold players', order: 999 };
        }
        log(s, `Fast round: ${unsold.length} unsold players return`);
        continue;
      }
      break;
    }
    const id = s.queue[s.qi];
    if (s.results[id]) continue;
    // First player of a new set: announce the set, then open this player after the intro.
    const p = playerById[id];
    const set = setOf(s, p.id);
    const setKey = s.round === 2 ? 'R2' : set.code;
    if (setKey !== s.currentSet) {
      s.currentSet = setKey;
      const players = s.queue.slice(s.qi).filter(x => !s.results[x] && (s.round === 2 || setOf(s, x).code === set.code));
      s.intro = s.round === 2
        ? { set: 'AR', name: 'Accelerated round', players }
        : { set: set.code, name: set.name, players };
      log(s, `${s.intro.name}: ${players.length} players`);
      s.qi--;
      s.hold = now + SET_INTRO_MS;
      return;
    }
    s.intro = null;
    const timer = s.round === 2 ? Math.min(s.settings.timer, RULES.timerAfterBid) : s.settings.timer;
    s.lot = { playerId: id, bid: null, leader: null, endsAt: now + timer * 1000, plan: null };
    return;
  }
  s.phase = 'done';
  log(s, 'Auction complete');
}

export function placeBid(s: GameState, team: TeamId, now: number): string | null {
  const lot = s.lot;
  if (!lot || s.rtm || s.paused || s.phase !== 'auction') return 'Bidding is closed';
  if (now >= lot.endsAt) return 'Too late';
  if (lot.leader === team) return 'You already have the highest bid';
  const p = playerById[lot.playerId];
  const amount = nextBid(lot.bid, p.base);
  const block = bidBlock(s.teams[team], p, amount);
  if (block) return block;
  lot.bid = amount;
  lot.leader = team;
  lot.plan = null;
  lot.endsAt = Math.max(lot.endsAt, now + RULES.timerAfterBid * 1000);
  return null;
}

function sell(s: GameState, playerId: string, team: TeamId, price: number, how: Acquired, now: number) {
  const t = s.teams[team];
  t.squad.push({ id: playerId, price, how });
  t.purse -= price;
  const result: Result = { status: 'sold', team, price, how };
  s.results[playerId] = result;
  s.lastEvent = { playerId, result };
  log(s, `${playerById[playerId].name} sold to ${team} for ${fmt(price)}${how === 'rtm' ? ' (RTM)' : ''}`);
  s.rtm = null;
  holdThen(s, now, SOLD_HOLD_MS);
}

/** Pause between players so the result can be shown (and the tune played). */
function holdThen(s: GameState, now: number, ms: number) {
  s.lot = null;
  s.hold = now + ms;
}

function closeLot(s: GameState, now: number) {
  const lot = s.lot!;
  const p = playerById[lot.playerId];
  if (!lot.leader || lot.bid === null) {
    const result: Result = { status: 'unsold' };
    s.results[p.id] = result;
    s.lastEvent = { playerId: p.id, result };
    log(s, `${p.name} unsold`);
    holdThen(s, now, UNSOLD_HOLD_MS);
    return;
  }
  const holder = p.lastTeam;
  if (s.settings.mode === 'mega' && holder && holder !== lot.leader) {
    const h = s.teams[holder];
    if (h.rtm > 0 && !bidBlock(h, p, lot.bid)) {
      s.rtm = { playerId: p.id, holder, buyer: lot.leader, price: lot.bid, stage: 'match', at: now + 900 };
      log(s, `${holder} can use RTM on ${p.name}`);
      return;
    }
  }
  sell(s, p.id, lot.leader, lot.bid, 'bought', now);
}

// ---------- RTM ----------

/** stage 'match': holder answers. stage 'final': holder answers the raised price. */
export function rtmAnswer(s: GameState, useCard: boolean, now: number) {
  const o = s.rtm;
  if (!o || o.stage === 'raise') return;
  if (!useCard) { sell(s, o.playerId, o.buyer, o.price, 'bought', now); return; }
  if (o.stage === 'match') { o.stage = 'raise'; o.at = now + 900; return; }
  s.teams[o.holder].rtm--;
  sell(s, o.playerId, o.holder, o.price, 'rtm', now);
}

/** Buyer's one last raise after the holder matched; null = no raise. */
export function rtmRaise(s: GameState, amount: number | null, now: number) {
  const o = s.rtm;
  if (!o || o.stage !== 'raise') return;
  const p = playerById[o.playerId];
  if (amount === null || amount <= o.price || bidBlock(s.teams[o.buyer], p, amount)) {
    s.teams[o.holder].rtm--;
    sell(s, o.playerId, o.holder, o.price, 'rtm', now);
    return;
  }
  o.price = amount;
  if (bidBlock(s.teams[o.holder], p, amount)) { sell(s, o.playerId, o.buyer, amount, 'bought', now); return; }
  o.stage = 'final';
  o.at = now + 900;
  log(s, `${o.buyer} raised to ${fmt(amount)}`);
}

// ---------- clock + bots ----------

/** Advance the game to `now`: bot bids, RTM decisions, closing lots. */
export function tick(s: GameState, now: number) {
  if (s.phase !== 'auction' || s.paused) return;
  if (s.hold) {
    if (now >= s.hold) { s.hold = null; openNext(s, now); }
    return;
  }
  const o = s.rtm;
  if (o) {
    const decider = o.stage === 'raise' ? o.buyer : o.holder;
    if (s.teams[decider].human) {
      if (now - o.at > 15000) { if (o.stage === 'raise') rtmRaise(s, null, now); else rtmAnswer(s, false, now); }
      return;
    }
    if (now < o.at) return;
    if (o.stage === 'raise') rtmRaise(s, botRtmRaise(s, o), now);
    else rtmAnswer(s, botWantsRtm(s, o), now);
    return;
  }
  const lot = s.lot;
  if (!lot) return;
  if (lot.plan && now >= lot.plan.at) {
    const team = lot.plan.team;
    lot.plan = null;
    placeBid(s, team, now);
  }
  if (!lot.plan) {
    const team = pickBidder(s, random(s));
    if (team) {
      const [lo, hi] = BOT_DELAY[s.settings.level];
      let at = now + lo + random(s) * (hi - lo);
      if (s.settings.level === 'hard' && random(s) < 0.25) at = lot.endsAt - 1200 - random(s) * 800;
      lot.plan = { team, at: Math.max(now + 300, Math.min(at, lot.endsAt - 400)) };
    }
  }
  if (now >= lot.endsAt && s.lot === lot) closeLot(s, now);
}

/** "Skip": the human sits out this player; bots finish the bidding at once. */
export function skipLot(s: GameState, now: number) {
  const lot = s.lot;
  if (!lot || s.rtm || s.paused) return;
  for (let i = 0; i < 400; i++) {
    const team = pickBidder(s, random(s), true);
    if (!team || placeBid(s, team, lot.endsAt - 1)) break;
  }
  closeLot(s, now);
  // Let bot RTM decisions resolve straight away too.
  for (let o = s.rtm as RtmOffer | null; o && !s.teams[o.stage === 'raise' ? o.buyer : o.holder].human; o = s.rtm as RtmOffer | null) {
    o.at = now;
    tick(s, now);
  }
}

export function setPaused(s: GameState, paused: boolean, now: number) {
  if (paused && !s.paused && s.lot) {
    s.paused = { left: Math.max(1000, s.lot.endsAt - now) };
    s.lot.plan = null;
  } else if (!paused && s.paused) {
    if (s.lot) s.lot.endsAt = now + s.paused.left;
    s.paused = null;
  }
}

export { botMaxBid };
