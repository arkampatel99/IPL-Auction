// What the auctioneer says between bids, built from each player's own numbers.
// Every fact has several phrasings; recently used phrasings are avoided across players,
// so the same sentence doesn't keep coming back.

import { teamById, type TeamId } from '../data/teams';
import { roleLabel, type Player } from '../game/players';
import type { Lot } from '../game/engine';
import { nextBid } from '../game/rules';
import { spokenMoney } from './voice';

type Line = { id: string; family: string; text: string };

// Phrasings used recently, across all players (oldest first).
const recent: string[] = [];
const remember = (id: string) => { recent.push(id); if (recent.length > 60) recent.shift(); };
const freshness = (id: string) => { const i = recent.lastIndexOf(id); return i < 0 ? 999 : recent.length - i; };

/** Pick a phrasing for one fact, preferring ones not heard for a while. */
function pickFrom(family: string, options: string[]): Line {
  const scored = options.map((text, i) => ({ id: `${family}#${i}`, family, text, f: freshness(`${family}#${i}`) + Math.random() * 3 }));
  scored.sort((a, b) => b.f - a.f);
  return scored[0];
}

const surname = (p: Player) => p.name.split(' ').slice(-1)[0];
const first = (p: Player) => p.name.split(' ')[0];

/** Every fact worth saying about this player, each with several ways to say it. */
function factPool(p: Player, team: TeamId | null): Line[] {
  const s = p.stats;
  const n = surname(p);
  const lg = p.statsFrom === 'T20I' ? 'T20I' : p.statsFrom === 'League' ? 'T20 league' : 'IPL';
  const out: Line[] = [];
  const add = (family: string, options: string[]) => out.push(pickFrom(family, options));

  // Name recognition
  if (p.star >= 80) add('legend', [
    `A legend of the game. The crowd loves him.`,
    `One of the biggest names in cricket, ladies and gentlemen.`,
    `Do I need to introduce ${n}? A true great.`,
    `This is a name that sells tickets.`,
    `Franchises build whole seasons around a player like ${n}.`,
  ]);
  else if (p.star >= 60) add('star', [
    `A big name, a real crowd puller.`,
    `A proven star of this league.`,
    `${n} has won matches on his own.`,
    `Fans will be very happy to see ${n} in their colours.`,
  ]);
  if (p.rating >= 88) add('elite', [
    `One of the best in this auction.`,
    `A genuine match-winner, this one.`,
    `Top drawer. Class written all over him.`,
    `If you want quality, it does not get better than this.`,
  ]);
  else if (p.rating >= 78) add('quality', [
    `A quality cricketer in prime form.`,
    `Very consistent numbers here.`,
    `A player who fits into any XI.`,
  ]);

  // Batting
  const bats = p.role === 'BAT' || p.role === 'WK' || p.role === 'AR';
  if (bats && s.runs > 0 && p.statsFrom) {
    if (s.sr >= 160) add('sr', [
      `A strike rate of ${s.sr}. That is box-office hitting.`,
      `${s.sr} strike rate. Bowlers will not enjoy this.`,
      `He scores at ${s.sr} runs per hundred balls. Pure fireworks.`,
    ]);
    else if (s.sr >= 145) add('sr', [
      `Strike rate of ${s.sr}. A real impact player.`,
      `He moves the scoreboard fast: ${s.sr} per hundred balls.`,
      `${s.sr} strike rate. Just what the middle overs need.`,
    ]);
    else if (s.sr >= 130) add('sr', [
      `Scores quickly, strike rate ${s.sr}.`,
      `A steady ${s.sr} strike rate. Can anchor and accelerate.`,
    ]);
    if (s.runs >= 4000) add('runs', [
      `Over ${Math.floor(s.runs / 1000) * 1000} ${lg} runs. A run machine.`,
      `${s.runs} ${lg} runs. Huge, huge experience.`,
      `Few players have scored more than his ${s.runs} runs.`,
    ]);
    else if (s.runs >= 2000) add('runs', [
      `${s.runs} ${lg} runs to his name.`,
      `More than ${Math.floor(s.runs / 500) * 500} runs. Proven at this level.`,
      `${s.runs} runs. He knows how to win games with the bat.`,
    ]);
    else if (s.runs >= 800) add('runs', [
      `${s.runs} ${lg} runs so far.`,
      `Already ${s.runs} runs, and still improving.`,
    ]);
    if (s.avg >= 40 && s.matches >= 15) add('avg', [
      `An average of ${s.avg}. Remarkable in this format.`,
      `Averages ${s.avg}. You can set your watch by him.`,
    ]);
    else if (s.avg >= 30 && s.matches >= 15) add('avg', [
      `Averages ${s.avg}. Very consistent.`,
      `A batting average of ${s.avg}. Reliable.`,
    ]);
  }

  // Bowling
  const bowls = p.role === 'BOWL' || p.role === 'AR';
  if (bowls && s.wickets > 0 && p.statsFrom) {
    if (s.wickets >= 150) add('wk', [
      `${s.wickets} ${lg} wickets. One of the all-time greats with the ball.`,
      `A wicket haul of ${s.wickets}. That is extraordinary.`,
    ]);
    else if (s.wickets >= 80) add('wk', [
      `${s.wickets} ${lg} wickets. A proven wicket-taker.`,
      `He has taken ${s.wickets} wickets. Captains love that.`,
      `${s.wickets} scalps and counting.`,
    ]);
    else if (s.wickets >= 30) add('wk', [
      `${s.wickets} wickets in the ${lg}.`,
      `${s.wickets} wickets so far. Breakthroughs guaranteed.`,
    ]);
    if (s.econ > 0 && s.econ <= 7.2) add('econ', [
      `An economy of just ${s.econ}. Gold dust in T20 cricket.`,
      `Goes at only ${s.econ} an over. Batters struggle to get him away.`,
      `${s.econ} economy. He strangles the run rate.`,
    ]);
    else if (s.econ > 0 && s.econ <= 8) add('econ', [
      `Economy of ${s.econ}. Hard to score off.`,
      `Keeps it tight, around ${s.econ} an over.`,
    ]);
    if (p.bowlType === 'SPIN') add('style', [
      `Spin option for the middle overs.`,
      `Turns it both ways. Lovely on slow pitches.`,
      `A spinner who can control a game.`,
      `On a turning track, he is a nightmare.`,
    ]);
    else if (p.role === 'BOWL') add('style', [
      `Pace for the powerplay and the death.`,
      `Quick bowler, takes the new ball.`,
      `Hits the deck hard. Batters hurry their shots.`,
      `Yorkers at the death, if you need them.`,
    ]);
  }
  if (p.role === 'AR') add('role', [
    `A genuine all-rounder. Two players in one.`,
    `Bats, bowls, fields. Balances any side.`,
    `All-rounders like this are hard to find.`,
  ]);
  if (p.role === 'WK') add('role', [
    `Keeps wicket too. Two jobs in one.`,
    `A keeper who can bat. Every team needs one.`,
    `Safe gloves behind the stumps.`,
  ]);

  // Background
  if (p.overseas) add('origin', [
    `He comes from ${p.country}.`,
    `An overseas option from ${p.country}. Choose your four wisely.`,
    `${p.country} international. Take note of your overseas slots.`,
  ]);
  else if (p.capped) add('origin', [
    `An India international.`,
    `Has played for India. Big-match temperament.`,
  ]);
  if (!p.capped) add('uncapped', [
    `Uncapped. One for the future.`,
    `Uncapped, but plenty of promise.`,
    `Could this be the next breakout star?`,
    `A smart buy could make him a bargain.`,
  ]);
  if (!p.statsFrom) add('new', [
    `A new name, no IPL games yet.`,
    `Fresh talent from the domestic circuit.`,
    `Scouts have been watching ${first(p)}.`,
    `An unknown quantity. High risk, maybe high reward.`,
  ]);
  if (s.matches > 0 && s.matches < 15) add('games', [
    `Only ${s.matches} ${lg} games so far.`,
    `Just ${s.matches} matches. Still learning, still hungry.`,
  ]);
  if (s.matches >= 150) add('games', [
    `${s.matches} ${lg} matches. A real veteran.`,
    `${s.matches} games of experience. He has seen it all.`,
    `Big-match experience: ${s.matches} appearances.`,
  ]);
  if (team) add('team', [
    `Played for ${teamById[team].city} last season.`,
    `${teamById[team].city} will surely want him back.`,
    `Watch ${teamById[team].city}. They know him best.`,
  ]);
  return out;
}

export function introLine(p: Player) {
  const role = roleLabel(p), from = p.overseas ? p.country : 'India', base = spokenMoney(p.base);
  const l = pickFrom('intro', [
    `Next player, ${p.name}. ${role}, ${from}. Base price ${base}.`,
    `Coming up, ${p.name}. ${role} from ${from}, starting at ${base}.`,
    `Our next lot: ${p.name}, ${role}, ${from}. Base price ${base}.`,
    `Here is ${p.name}. ${role}. ${from}. We start at ${base}.`,
    `Ladies and gentlemen, ${p.name}. ${role}, ${from}. Base ${base}.`,
  ]);
  remember(l.id);
  return l.text;
}

/**
 * A line for a quiet moment: calls for bids and facts about the player, alternating.
 * `said` remembers what was used for this player (fact families and calls).
 */
export function idleLine(p: Player, lot: Lot, said: Set<string>, team: TeamId | null = p.lastTeam): string | null {
  const turn = [...said].filter(x => x.startsWith('turn:')).length;
  if (turn >= 7) return null;
  said.add(`turn:${turn}`);
  const facts = factPool(p, team).filter(f => !said.has(`fact:${f.family}`));
  const ask = lot.bid === null
    ? pickFrom('ask-open', [
      `Do we have a bid? ${spokenMoney(p.base)} for ${surname(p)}.`,
      `Who will start us off? ${spokenMoney(p.base)}.`,
      `Any bid at ${spokenMoney(p.base)}?`,
      `Come on, ${spokenMoney(p.base)} for a player like this?`,
      `Paddles up, please. ${spokenMoney(p.base)} to open.`,
      `Surely someone wants ${surname(p)} at ${spokenMoney(p.base)}.`,
    ])
    : pickFrom('ask-more', [
      `With ${teamById[lot.leader!].city} at ${spokenMoney(lot.bid)}. Any advance?`,
      `Do I hear ${spokenMoney(nextBid(lot.bid, p.base))}?`,
      `${spokenMoney(lot.bid)}, it's with ${teamById[lot.leader!].city}.`,
      `${teamById[lot.leader!].city} hold it at ${spokenMoney(lot.bid)}. Anyone else?`,
      `Still a bargain at ${spokenMoney(lot.bid)}.`,
      `Last chance at ${spokenMoney(lot.bid)}.`,
    ]);
  // Ask first, then a fact, then ask again, and so on.
  const useFact = facts.length > 0 && turn % 2 === 1;
  const line = useFact ? facts[Math.floor(Math.random() * Math.min(3, facts.length))] : ask;
  if (useFact) said.add(`fact:${line.family}`);
  remember(line.id);
  return line.text;
}
