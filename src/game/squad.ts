// Squad ratings out of 100, from each player's rating (his stats, form and experience),
// the shape of the best XI, bench depth and value for money.

import { playerById, type Player } from './players';
import { RULES } from './rules';
import type { TeamState } from './engine';

/** Best XI: max 4 overseas, at least 1 keeper and 5 bowling options. */
export function bestXI(t: TeamState): Player[] {
  const all = t.squad.map(e => playerById[e.id]).sort((a, b) => b.rating - a.rating);
  const xi: Player[] = [];
  const os = () => xi.filter(p => p.overseas).length;
  const add = (p: Player) => { if (xi.length < 11 && !xi.includes(p) && (!p.overseas || os() < 4)) xi.push(p); };
  const keeper = all.find(p => p.role === 'WK');
  if (keeper) add(keeper);
  for (const p of all.filter(p => p.role === 'BOWL' || p.role === 'AR').slice(0, 5)) add(p);
  for (const p of all) add(p);
  return xi;
}

export interface SquadReport {
  overall: number;      // 0–100, spread so differences show
  score: number;        // unrounded overall, for tie-breaks
  grade: string;        // A+ … D
  batting: number;      // top 6 batting options in the XI
  bowling: number;      // top 5 bowling options in the XI
  balance: number;      // keeper, spin + pace, enough options
  depth: number;        // best 4 on the bench
  star: number;         // star power of the 5 biggest names
  value: number;        // fair value of squad vs money spent
  xi: Player[];
  strengths: string[];
  weaknesses: string[];
  bestBuy: { player: Player; price: number } | null;
  topBuy: { player: Player; price: number } | null;
  spent: number;
}

const avg = (xs: number[], n: number, missing = 35) => {
  const top = [...xs].sort((a, b) => b - a).slice(0, n);
  while (top.length < n) top.push(missing);
  return top.reduce((a, b) => a + b, 0) / n;
};
const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));

/** Grades on the same scale as player ratings: an A squad is full of A players. */
export function gradeOf(score: number) {
  return score >= 90 ? 'A+' : score >= 86 ? 'A' : score >= 82 ? 'B+' : score >= 78 ? 'B' : score >= 72 ? 'C+' : score >= 65 ? 'C' : 'D';
}

/** `live`: during the auction, don't penalise a squad for not having 18 players yet. */
export function squadReport(t: TeamState, opts: { live?: boolean } = {}): SquadReport {
  const squad = t.squad.map(e => ({ p: playerById[e.id], price: e.price, how: e.how }));
  const xi = bestXI(t);
  const batters = xi.filter(p => p.role !== 'BOWL');
  const bowlers = xi.filter(p => p.role === 'BOWL' || p.role === 'AR');
  // Live (mid-auction): empty slots count as a replacement-level player, not as a hole.
  const fill = opts.live ? 62 : 35;
  const batting = clamp(avg(batters.map(p => p.rating), 6, fill));
  const bowling = clamp(avg(bowlers.map(p => p.rating), 5, fill));
  const bench = squad.map(x => x.p).filter(p => !xi.includes(p));
  const depth = clamp(avg(bench.map(p => p.rating), 4, opts.live ? 55 : 30));
  const star = clamp(avg(squad.map(x => x.p.star), 5, opts.live ? 25 : 0));
  // Balance is only judged once a squad is mostly built.
  const judgeBalance = !opts.live || squad.length >= 15;

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  let balance = 100;
  const hasKeeper = xi.some(p => p.role === 'WK');
  const spinners = bowlers.filter(p => p.bowlType === 'SPIN').length;
  const pacers = bowlers.filter(p => p.bowlType !== 'SPIN').length;
  if (judgeBalance) {
    if (!hasKeeper) { balance -= 20; weaknesses.push('No wicket-keeper'); }
    if (bowlers.length < 5) { balance -= 12; weaknesses.push(`Only ${bowlers.length} bowling options`); }
    if (!spinners) { balance -= 10; weaknesses.push('No specialist spinner'); }
    if (pacers < 2) { balance -= 10; weaknesses.push('Short of pace'); }
    if (batters.length < 6) { balance -= 10; weaknesses.push('Thin batting line-up'); }
    if (xi.filter(p => p.overseas).length < 3) { balance -= 4; weaknesses.push('Few overseas stars in the XI'); }
  }
  balance = clamp(balance);

  // Value: what the squad is "worth" against what was paid (retentions count at their slab price).
  const spent = squad.reduce((a, x) => a + x.price, 0);
  const worth = squad.reduce((a, x) => a + x.p.value, 0);
  const value = clamp(spent ? (worth / spent) * 70 : opts.live ? 70 : 0);

  const short = opts.live ? 0 : Math.max(0, RULES.squadMin - squad.length);
  if (short) weaknesses.push(`${short} short of the 18-player minimum`);
  if (squad.length && depth < 50) weaknesses.push('Thin bench');

  if (batting >= 80) strengths.push('Explosive batting'); else if (batting >= 74) strengths.push('Solid batting');
  if (bowling >= 80) strengths.push(spinners >= 2 ? 'Strong spin attack' : 'Strong pace attack');
  else if (bowling >= 74) strengths.push('Good bowling attack');
  if (depth >= 65) strengths.push('Deep bench');
  if (value >= 80) strengths.push('Great value for money');
  if (balance === 100) strengths.push('Perfectly balanced XI');
  const legends = squad.filter(x => x.p.star >= 80).map(x => x.p.name.split(' ').slice(-1)[0]);
  if (legends.length) strengths.push(`Legends: ${legends.join(', ')}`);
  else if (star >= 60) strengths.push('Star-studded squad');
  if (squad.length && star < 35) weaknesses.push('Few big names');

  // Raw blend sits around 75–88 for real squads; stretch it so a strong squad clearly beats an average one.
  // The rating is the quality of the players you have: the average rating of your best XI
  // (best players count a little more), plus a small bonus for big names.
  // Live (mid-auction): only the players bought so far. Final: missing XI places count as weak fill-ins,
  // and gaps in the squad cost a few points.
  const xiRatings = xi.map(p => p.rating).sort((a, b) => b - a);
  if (!opts.live) while (xiRatings.length < 11) xiRatings.push(45);
  const weights = xiRatings.map((_, i) => 1.25 - i * 0.05); // 1.25 for the best player down to 0.75
  const quality = xiRatings.length ? xiRatings.reduce((a, r, i) => a + r * weights[i], 0) / weights.slice(0, xiRatings.length).reduce((a, b) => a + b, 0) : 0;
  const topStars = squad.map(x => x.p.star).sort((a, b) => b - a).slice(0, 3);
  const starBonus = topStars.length ? Math.max(0, Math.min(4, (topStars.reduce((a, b) => a + b, 0) / topStars.length - 50) / 10)) : 0;
  const finalAdjust = opts.live ? 0 : (balance - 100) * 0.06 + (depth - 60) * 0.05 + (value - 70) * 0.03 - short * 1.5;
  const score = squad.length ? Math.max(0, Math.min(100, quality + starBonus + finalAdjust)) : 0;
  const overall = Math.round(score);

  const bought = squad.filter(x => x.how !== 'retained');
  const bestBuy = bought.length ? bought.reduce((a, b) => (b.p.value - b.price > a.p.value - a.price ? b : a)) : null;
  const topBuy = bought.length ? bought.reduce((a, b) => (b.price > a.price ? b : a)) : null;

  return {
    overall, score, grade: gradeOf(overall), batting, bowling, balance, depth, value, star, xi, strengths, weaknesses, spent,
    bestBuy: bestBuy && { player: bestBuy.p, price: bestBuy.price },
    topBuy: topBuy && { player: topBuy.p, price: topBuy.price },
  };
}

/** Squad rating out of 100. */
export function squadRating(t: TeamState): number {
  return squadReport(t).overall;
}
