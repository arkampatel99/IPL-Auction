import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TEAM_IDS, teamById, type TeamId } from '../data/teams';
import { RULES, nextBid } from '../game/rules';
import { playerById, roleLabel, starLabel, type Player, type Role } from '../game/players';
import {
  bidBlock, currentPlayer, setOf, shownTeam, nextAmount, overseasCount, placeBid, reserveNeeded, rtmAnswer, rtmRaise,
  setPaused, skipLot, type GameState,
} from '../game/engine';
import { TARGET } from '../game/bots';
import { squadReport } from '../game/squad';
import { CloseIcon, PlayerPhoto, TeamLogo, TeamTag, TopBar, money } from '../ui/common';
import { primeVoice, quietFor, say, setVoiceOn, spokenMoney, voiceOn, voiceSupported } from '../ui/voice';
import { idleLine, introLine } from '../ui/commentary';
import { playTeamTune, knock } from '../ui/music';
import TeamSheet from './TeamSheet';
import SoldPopup from './SoldPopup';
import AuctioneerStage, { type Call } from './AuctioneerStage';
import { isAdmin } from '../ui/admin';
import { getColorPref, setColorPref } from '../ui/theme';
import type { Act } from './Game';
import { guestRoom, hostRoom, inviteLink } from '../net/room';

/** `guest`: a friend following the host's auction (no pause, actions go to the host). */
export default function Auction({ state, act, guest }: { state: GameState; act: Act; guest?: boolean }) {
  const multi = (state.settings.humans?.length ?? 0) > 1;
  const nav = useNavigate();
  const p = currentPlayer(state);
  const [sheet, setSheet] = useState<TeamId | null>(null);
  const [panel, setPanel] = useState(false); // players, teams, my squad, log: hidden until you ask
  const [menu, setMenu] = useState(false);
  const [voice, setVoice] = useState(voiceOn());
  const call = useAuctioneer(state);
  const outbidBy = useOutbid(state);
  const ratings = useRatings(state);

  // Keyboard: B / Space = bid, S = skip, P = pause, L = lists, Esc = close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { setPanel(false); setMenu(false); return; }
      if (k === 'l') { setPanel(o => !o); return; }
      if (k === 'p') { if (!guest) { primeVoice(); act((s, now) => setPaused(s, !s.paused, now)); } return; }
      if (k === 'b' || k === ' ') {
        e.preventDefault();
        primeVoice();
        act((s, now) => { if (s.lot && s.lot.leader !== s.settings.team) placeBid(s, s.settings.team, now); });
        return;
      }
      if (k === 's' && !multi) act((s, now) => { if (s.lot && s.lot.leader !== s.settings.team && !s.rtm && !s.paused) skipLot(s, now); });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act]);

  // Phones: the bid bar is pinned to the bottom, so the page leaves exactly its height free.
  const shellRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = barRef.current, shell = shellRef.current;
    if (!bar || !shell || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => shell.style.setProperty('--bidbar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="app-shell" ref={shellRef}>
      <TopBar>
        <button type="button" className={`btn sm${panel ? ' primary' : ''}`} aria-expanded={panel} onClick={() => setPanel(o => !o)}>
          <span className="btn-label">Players & squads</span><span className="show-phone" aria-hidden>Lists</span>
        </button>
        {!guest && (
          <button type="button" className="btn sm" onClick={() => { primeVoice(); act((s, now) => setPaused(s, !s.paused, now)); }}>
            {state.paused ? 'Resume' : 'Pause'}
          </button>
        )}
        <div className="menu-wrap">
          <button type="button" className={`btn sm${menu ? ' primary' : ''}`} aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(m => !m)}>Menu</button>
          {menu && (
            <div className="menu" role="menu" onClick={() => setMenu(false)}>
              {voiceSupported() && (
                <button type="button" role="menuitem" onClick={() => { setVoiceOn(!voice); setVoice(!voice); }}>
                  {voice ? 'Sound: on (tap to mute)' : 'Sound: off (tap to turn on)'}
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => setColorPref(getColorPref() === 'team' ? 'gold' : 'team')}>
                Theme colour: {getColorPref() === 'team' ? 'your team (tap for gold)' : 'gold (tap for your team)'}
              </button>
              {isAdmin && <button type="button" role="menuitem" onClick={() => { act((s, now) => setPaused(s, true, now)); nav('/songs'); }}>Team songs</button>}
              {isAdmin && <button type="button" role="menuitem" onClick={() => { act((s, now) => setPaused(s, true, now)); nav('/photos'); }}>Player photos</button>}
              {state.settings.names && <RoomMenu state={state} guest={guest} />}
              <hr />
              <button type="button" role="menuitem" onClick={() => { act((s, now) => setPaused(s, true, now)); nav('/'); }}>
                Exit to home <span className="small muted">· your game is saved</span>
              </button>
            </div>
          )}
        </div>
      </TopBar>
      <main className={`auction${panel ? ' with-panel' : ''}`}>
        <aside className="left"><Teams state={state} ratings={ratings} onOpen={setSheet} /></aside>
        <section className="center">
          {p
            ? <>
                <Tips multi={multi} /><RecentSales state={state} /><LotCard state={state} player={p} />
                {/* Phones: use the space above the bid bar for squad needs and the next players. */}
                <NextLine state={state} />
              </>
            : state.hold && state.intro ? <SetIntroCard state={state} />
            : state.hold ? <ResultCard state={state} /> : null}
          <div className="stage-wide"><AuctioneerStage state={state} call={call} /></div>
          <div className="bidbar-wrap" ref={barRef}><BidPanel state={state} act={act} outbidBy={outbidBy} call={call} rating={ratings[state.settings.team]} multi={multi} /></div>
        </section>
        {panel && (
          <aside className="right card drawer" aria-label="Players and squads">
            <div className="drawer-head">
              <b>Players & squads</b>
              <button type="button" className="btn sm ghost" onClick={() => setPanel(false)} aria-label="Close"><CloseIcon /></button>
            </div>
            <NextUp state={state} />
            <SidePanel state={state} ratings={ratings} onOpen={setSheet} />
          </aside>
        )}
      </main>
      <RtmDialog state={state} act={act} />
      <SoldPopup state={state} />
      <Milestones state={state} />
      {sheet && <TeamSheet state={state} team={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}

// ---------- milestones ----------

/** Small celebrations as your squad takes shape: first signing, first overseas player, XI, 18 players. */
function Milestones({ state }: { state: GameState }) {
  const t = state.teams[state.settings.team];
  const bought = t.squad.filter(e => e.how !== 'retained');
  const os = t.squad.filter(e => playerById[e.id].overseas).length;
  const seen = useRef<Set<string> | null>(null);
  const [toast, setToast] = useState<{ key: string; title: string; text: string } | null>(null);
  useEffect(() => {
    const checks: [string, boolean, string, string][] = [
      ['first', bought.length >= 1, 'First signing', `${playerById[bought[0]?.id ?? '']?.name ?? ''} is yours.`],
      ['overseas', bought.some(e => playerById[e.id].overseas), 'First overseas star', `${os} of ${RULES.overseasMax} overseas slots used.`],
      ['xi', t.squad.length >= 11, 'Playing XI ready', 'You have 11 players. Now build depth.'],
      ['min', t.squad.length >= RULES.squadMin, 'Squad complete', `${RULES.squadMin} players: you meet the minimum.`],
    ];
    if (!seen.current) { seen.current = new Set(checks.filter(c => c[1]).map(c => c[0])); return; } // already true when the game opened
    const hit = checks.find(c => c[1] && !seen.current!.has(c[0]));
    if (!hit) return;
    seen.current.add(hit[0]);
    const timer = setTimeout(() => setToast({ key: hit[0], title: hit[2], text: hit[3] }), 5600); // after the sold moment
    const clear = setTimeout(() => setToast(null), 9600);
    return () => { clearTimeout(timer); clearTimeout(clear); };
  }, [t.squad.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!toast) return null;
  return (
    <div className="milestone" key={toast.key} role="status">
      <span className="milestone-icon" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      </span>
      <span><b>{toast.title}</b><br /><span className="small muted">{toast.text}</span></span>
    </div>
  );
}

// ---------- live squad ratings ----------

type Ratings = Record<TeamId, { overall: number; grade: string }>;

/** Every team's squad rating, recomputed only when a squad changes. */
function useRatings(s: GameState): Ratings {
  const key = TEAM_IDS.map(id => s.teams[id].squad.length).join(',');
  return useMemo(() => Object.fromEntries(TEAM_IDS.map(id => {
    const r = squadReport(s.teams[id], { live: true });
    return [id, { overall: r.overall, grade: r.grade }];
  })) as Ratings, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------- voice + alerts ----------

/**
 * The auctioneer: introduces each player, calls every bid, fills quiet moments with
 * lines about the player, says "going once, going twice", and the result.
 * Returns the last call, which the on-screen auctioneer shows (even with sound off).
 */
function useAuctioneer(s: GameState): Call | null {
  const lot = s.lot;
  const seen = useRef({ player: '', bid: '', call: '', twice: '', event: '', rtm: '', intro: '' });
  const said = useRef(new Set<string>());
  const lastLineAt = useRef(0);
  const [call, setCall] = useState<Call | null>(null);
  const left = lot && !s.paused ? lot.endsAt - Date.now() : Infinity;

  const speak = (text: string, kind: Call['kind'], extra: Partial<Call> = {}) => {
    lastLineAt.current = Date.now();
    setCall({ text, kind, at: Date.now(), ...extra });
    say(text, kind);
  };

  useEffect(() => {
    const e = s.lastEvent;
    const key = e ? `${e.playerId}:${e.result.status}` : '';
    if (!e || key === seen.current.event) return;
    seen.current.event = key;
    const name = playerById[e.playerId].name;
    if (e.result.status === 'sold') {
      speak(`Sold! ${name} to ${teamById[e.result.team!].name}, for ${spokenMoney(e.result.price!)}${e.result.how === 'rtm' ? ', with the right to match' : ''}.`, 'result',
        { team: e.result.team, amount: e.result.price, sold: true });
      if (voiceOn()) { knock(); playTeamTune(e.result.team!, 0.45); }
    } else {
      speak(`${name}, unsold.`, 'result', { sold: false });
    }
  }, [s.lastEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const i = s.intro;
    const key = i ? `${s.round}:${i.set}` : '';
    if (!i || key === seen.current.intro) return;
    seen.current.intro = key;
    const n = i.players.length;
    speak(i.set === 'AR'
      ? `The accelerated round. ${n} unsold players come back, with less time on the clock.`
      : `Now, ${i.name}. ${n} ${n === 1 ? 'player' : 'players'} in this set.`, 'result');
  }, [s.intro?.set, s.round]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lot || lot.playerId === seen.current.player) return;
    seen.current.player = lot.playerId;
    said.current = new Set();
    speak(introLine(playerById[lot.playerId]), 'intro');
  }, [lot?.playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lot?.leader || lot.bid === null) return;
    const key = `${lot.playerId}:${lot.bid}`;
    if (key === seen.current.bid) return;
    seen.current.bid = key;
    speak(`${teamById[lot.leader].city}, ${spokenMoney(lot.bid)}.`, 'bid', { team: lot.leader, amount: lot.bid });
  }, [lot?.bid, lot?.leader]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lot?.leader || left > 3000) return;
    const key = `${lot.playerId}:${lot.bid}`;
    if (key === seen.current.call) return;
    seen.current.call = key;
    speak(`Going once, ${teamById[lot.leader].city}.`, 'call');
  }, [left <= 3000, lot?.bid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lot?.leader || left > 1500) return;
    const key = `${lot.playerId}:${lot.bid}`;
    if (key === seen.current.twice) return;
    seen.current.twice = key;
    speak('Going twice…', 'call');
  }, [left <= 1500, lot?.bid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quiet moment: say something about the player, or ask for a bid.
  useEffect(() => {
    if (!lot || s.paused || s.rtm || left < 4500) return;
    if (Date.now() - lastLineAt.current < 4000 || quietFor() < 1200) return;
    const line = idleLine(playerById[lot.playerId], lot, said.current, shownTeam(s, playerById[lot.playerId]));
    if (!line) return;
    said.current.add(line);
    speak(line, 'intro');
  });

  useEffect(() => {
    const o = s.rtm;
    const key = o ? `${o.playerId}:${o.stage}` : '';
    if (!o || key === seen.current.rtm) return;
    seen.current.rtm = key;
    if (o.stage === 'match') speak(`${teamById[o.holder].name} can use the right to match.`, 'intro');
    if (o.stage === 'final') speak(`${teamById[o.buyer].city} raise to ${spokenMoney(o.price)}.`, 'bid', { team: o.buyer, amount: o.price });
  }, [s.rtm?.stage, s.rtm?.playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  return call;
}

/** Announces a new set before its first player: name, code and who is in it. */
function SetIntroCard({ state }: { state: GameState }) {
  const i = state.intro!;
  const kind = i.set === 'AR' ? 'Unsold players return' : i.set === 'RL' ? 'Your releases' : i.set.startsWith('M') ? 'Marquee' : i.set.startsWith('U') ? 'Uncapped' : 'Capped';
  return (
    <article className="set-intro" key={`${state.round}:${i.set}`}>
      <div className="set-kicker">{kind}</div>
      <div className="set-code">{i.set}</div>
      <h2 className="set-name">{i.name}</h2>
      <div className="set-count">{i.players.length} {i.players.length === 1 ? 'player' : 'players'}</div>
      <div className="set-faces">
        {i.players.slice(0, 12).map((id, n) => (
          <div key={id} className="set-face" style={{ animationDelay: `${600 + n * 90}ms` }}>
            <PlayerPhoto player={playerById[id]} size={44} />
            <span>{playerById[id].name.split(' ').slice(-1)[0]}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

/** Shown for a few seconds after each result: the buying team's colours, logo and price. */
function ResultCard({ state }: { state: GameState }) {
  const e = state.lastEvent;
  if (!e) return null;
  const p = playerById[e.playerId];
  const left = Math.max(0, Math.ceil(((state.hold ?? 0) - Date.now()) / 1000));
  if (e.result.status === 'unsold') {
    return (
      <article className="card pad result-card unsold-card">
        <PlayerPhoto player={p} size={96} />
        <div className="stack" style={{ gap: 4 }}>
          <span className="stamp">Unsold</span>
          <div className="lot-name">{p.name}</div>
          <div className="muted">Next player in {left} s</div>
        </div>
      </article>
    );
  }
  const t = teamById[e.result.team!];
  const mine = e.result.team === state.settings.team;
  return (
    <article className="result-card sold-card" style={{ background: t.color, color: t.ink }}>
      <div className="sold-logo"><TeamLogo id={t.id} size={88} /></div>
      <PlayerPhoto player={p} size={120} />
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <span className="stamp" style={{ borderColor: t.ink }}>{e.result.how === 'rtm' ? 'Sold · RTM' : 'Sold'}</span>
        <div className="lot-name">{p.name}</div>
        <div>to {mine ? 'you' : t.name}</div>
        <div className="price num">{money(e.result.price!)}</div>
        <div className="chant">{t.chant}</div>
        <div className="small" style={{ opacity: 0.8 }}>Next player in {left} s</div>
      </div>
    </article>
  );
}

/** The team that just took the lead from you, shown for a few seconds. */
function useOutbid(s: GameState): TeamId | null {
  const me = s.settings.team;
  const prev = useRef<{ player?: string; leader?: TeamId | null }>({});
  const [by, setBy] = useState<TeamId | null>(null);
  const lot = s.lot;
  useEffect(() => {
    const was = prev.current;
    if (lot && was.player === lot.playerId && was.leader === me && lot.leader && lot.leader !== me) {
      setBy(lot.leader);
      navigator.vibrate?.(120);
      const t = setTimeout(() => setBy(null), 3000);
      prev.current = { player: lot.playerId, leader: lot.leader };
      return () => clearTimeout(t);
    }
    if (lot?.leader === me) setBy(null);
    prev.current = { player: lot?.playerId, leader: lot?.leader };
  }, [lot?.playerId, lot?.leader]); // eslint-disable-line react-hooks/exhaustive-deps
  return by;
}

// ---------- panels ----------

function Teams({ state, ratings, onOpen }: { state: GameState; ratings: Ratings; onOpen: (t: TeamId) => void }) {
  const leader = state.lot?.leader;
  return (
    <div className="team-strip">
      {TEAM_IDS.map(id => {
        const t = state.teams[id];
        const r = ratings[id];
        return (
          <button key={id} type="button" className={`team-chip${leader === id ? ' leading' : ''}${id === state.settings.team ? ' mine' : ''}`}
            style={{ ['--team' as string]: teamById[id].color }}
            onClick={() => onOpen(id)} aria-label={`${teamById[id].name}: view squad`}>
            <TeamLogo id={id} size={32} />
            <span className="chip-text">
              <span className="chip-code">{chipLabel(state, id)}</span>
              <span className="line num">{money(t.purse)} · {t.squad.length}/{RULES.squadMax} · {overseasCount(t)} OS</span>
              <span className="purse-bar" aria-hidden><i style={{ width: `${Math.round(100 * t.purse / startPurse(state, id))}%` }} /></span>
            </span>
            {t.squad.length > 0 && (
              <span className={`chip-rating g-${r.grade[0]}`} title="Squad rating out of 100">
                <b className="num">{r.overall}</b><span>{r.grade}</span>
              </span>
            )}
            {leader === id && <span className="lead-dot" aria-label="Highest bid" />}
          </button>
        );
      })}
    </div>
  );
}

/** What a team had to spend when the auction began (for the purse bars). */
function startPurse(state: GameState, id: TeamId) {
  const t = state.teams[id];
  const spent = t.squad.filter(e => e.how !== 'retained').reduce((a, e) => a + e.price, 0);
  return Math.max(1, t.purse + spent);
}

/** Last five sales, newest first. */
function RecentSales({ state }: { state: GameState }) {
  const sales = Object.entries(state.results)
    .filter(([, r]) => r.status === 'sold' && r.how !== 'retained')
    .slice(-5).reverse();
  if (!sales.length) return null;
  return (
    <div className="recent" aria-label="Recent sales">
      <span className="recent-label">Recent</span>
      {sales.map(([id, r]) => (
        <span key={id} className="recent-chip" style={{ borderColor: teamById[r.team!].color }}>
          <TeamLogo id={r.team!} size={18} />
          <span className="recent-name">{playerById[id].name.split(' ').slice(-1)[0]}</span>
          <b className="num">{money(r.price!)}</b>
        </span>
      ))}
    </div>
  );
}

/** Your squad against a balanced target, so you know what to chase. */
function Needs({ state, player, rating }: { state: GameState; player: Player; rating: { overall: number; grade: string } }) {
  const t = state.teams[state.settings.team];
  const count = (r: Role) => t.squad.filter(e => playerById[e.id].role === r).length;
  const os = overseasCount(t);
  const items: [string, number, number, boolean][] = [
    ['Batters', count('BAT'), TARGET.BAT, player.role === 'BAT'],
    ['Keepers', count('WK'), TARGET.WK, player.role === 'WK'],
    ['All-rounders', count('AR'), TARGET.AR, player.role === 'AR'],
    ['Bowlers', count('BOWL'), TARGET.BOWL, player.role === 'BOWL'],
  ];
  return (
    <div className="needs" aria-label="Your squad needs">
      <span className="need rating-need" title="Your squad rating out of 100">Your rating <b className="num">{rating.overall}</b> {rating.grade}</span>
      {items.map(([k, n, target, now]) => (
        <span key={k} className={`need${n >= target ? ' done' : ''}${now ? ' now' : ''}`}>{k} <b className="num">{n}/{target}</b></span>
      ))}
      <span className={`need${os >= RULES.overseasMax ? ' full' : ''}${player.overseas ? ' now' : ''}`}>Overseas <b className="num">{os}/{RULES.overseasMax}</b></span>
      <span className="need">Squad <b className="num">{t.squad.length}/{RULES.squadMax}</b></span>
    </div>
  );
}

/** Three tips, shown until dismissed. */
function Tips({ multi }: { multi?: boolean }) {
  const KEY = 'ipl-auction-tips-done';
  const [show, setShow] = useState(() => { try { return !localStorage.getItem(KEY); } catch { return false; } });
  if (!show) return null;
  const close = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } setShow(false); };
  return (
    <div className="tips card pad">
      <div className="row between"><b>How it works</b><button type="button" className="btn sm ghost" onClick={close}>Got it</button></div>
      <ol>
        <li><b>Bid</b> to raise. Highest bid at 0 s wins.</li>
        {!multi && <li><b>Skip</b> to pass on a player.</li>}
        <li>Tap a <b>team</b> to see its squad.</li>
      </ol>
    </div>
  );
}

/** Solid colour per set type: marquee gold, batters blue, all-rounders pink, keepers teal, pace red, spin green. */
export function setStyle(code: string): React.CSSProperties {
  const base = code.replace(/^U/, '').replace(/\d+$/, '');
  const c: Record<string, string> = { M: '#C99700', BA: '#2563EB', AL: '#DB2777', WK: '#0D9488', FA: '#DC2626', SP: '#16A34A', RL: '#EA580C', AR: '#64748B' };
  const bg = c[base] ?? '#475569';
  return code.startsWith('U') ? { background: 'transparent', color: bg, boxShadow: `inset 0 0 0 2px ${bg}` } : { background: bg, color: '#fff' };
}

/** Where we are: set n of N, player i of the set's size, plus overall progress. */
function progress(state: GameState, id: string) {
  const code = setOf(state, id).code;
  const codes: string[] = [];
  let inSet = 0, setSize = 0;
  state.queue.forEach((x, i) => {
    const c = setOf(state, x).code;
    if (!codes.includes(c)) codes.push(c);
    if (c === code) { setSize++; if (i <= state.qi) inSet++; }
  });
  return { setNo: codes.indexOf(code) + 1, sets: codes.length, inSet, setSize };
}

/** Our estimate of what the player is worth, as a range. */
function fairRange(p: Player) {
  const lo = Math.max(p.base, Math.round((p.value * 0.8) / 5) * 5);
  const hi = Math.max(lo + 10, Math.round((p.value * 1.25) / 5) * 5);
  return `${money(lo)} to ${money(hi)}`;
}

function statLine(p: Player) {
  const s = p.stats;
  const bat = [['Matches', s.matches], ['Runs', s.runs], ['Average', s.avg], ['Strike rate', s.sr]];
  const bowl = [['Matches', s.matches], ['Wickets', s.wickets], ['Economy', s.econ], ['Runs', s.runs]];
  const ar = [['Runs', s.runs], ['Strike rate', s.sr], ['Wickets', s.wickets], ['Economy', s.econ]];
  const byRole: Record<Role, (string | number)[][]> = { BAT: bat, WK: bat, BOWL: bowl, AR: ar };
  return byRole[p.role];
}

function LotCard({ state, player: p }: { state: GameState; player: Player }) {
  const pr = progress(state, p.id);
  const tid = shownTeam(state, p);
  const t = tid ? teamById[tid] : null;
  return (
    <div className="lot-wrap" style={{ ['--team' as string]: t?.color ?? '#5F656C' }}>
      <span className="blob b1" aria-hidden />
      <span className="blob b2" aria-hidden />
      {tid && <span className="lot-watermark" aria-hidden><TeamLogo id={tid} size={180} /></span>}
      <article className="lot glass">
        <div className="row between small muted">
          <span><b className="set-pill" style={setStyle(setOf(state, p.id).code)}>{setOf(state, p.id).code}</b> {setOf(state, p.id).name}</span>
          <span className="num">{state.round === 2 ? 'Accelerated · ' : ''}Set {pr.setNo} of {pr.sets} · player {pr.inSet} of {pr.setSize}</span>
        </div>
        <div className="set-progress" aria-hidden><div style={{ width: `${(pr.inSet / Math.max(1, pr.setSize)) * 100}%` }} /></div>
        <div className="lot-head">
          <PlayerPhoto player={p} size={88} team={tid} />
          <div className="stack" style={{ gap: 6, minWidth: 0, flex: 1 }}>
            <div className="lot-name">{p.name}</div>
            <div className="muted">{roleLabel(p)} · {p.overseas ? p.country : 'India'}</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className={`tag ${p.capped ? 'tag-capped' : 'tag-uncapped'}`}>{p.capped ? 'Capped' : 'Uncapped'}</span>
              {p.overseas && <span className="tag tag-os">Overseas</span>}
              <span className={`tag tag-rating r-${p.rating >= 85 ? 'hi' : p.rating >= 75 ? 'good' : p.rating >= 65 ? 'mid' : 'low'}`}>Rating {p.rating}</span>
              {starLabel(p.star) && <span className={`tag star-tag${p.star >= 80 ? ' legend' : ''}`}>{starLabel(p.star)} · {p.star}</span>}
            </div>
          </div>
          {tid && (
            <div className="prev-team">
              <TeamLogo id={tid} size={44} />
              <span className="small muted">{state.settings.mode === 'mini' && p.auction ? '2025' : '2026'}</span>
            </div>
          )}
        </div>
        {p.statsFrom ? (
          <div className="stats">
            {statLine(p).map(([k, v]) => (
              <div key={k} className={`stat stat-${String(k).toLowerCase().replace(/\s+/g, '-')}`}><div className="k">{k}</div><div className="v num">{v}</div></div>
            ))}
          </div>
        ) : (
          <div className="notice">New face · no IPL record yet</div>
        )}
        <div className="small muted">
          {p.statsFrom === 'IPL' ? 'IPL career' : p.statsFrom === 'T20I' ? 'T20I career' : p.statsFrom === 'League' ? 'T20 league career' : 'Domestic'}
          {' · '}Base {money(p.base)}{p.auction ? ` · #${p.auction.sr}` : ''}
        </div>
        <div className="fair">Fair value <b className="num">{fairRange(p)}</b></div>
        <MoreStats player={p} />
      </article>
    </div>
  );
}

/** Stats by competition, folded away until asked for. */
function MoreStats({ player: p }: { player: Player }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [p.id]);
  if (!p.comps.length) return null;
  return (
    <div className="more-stats">
      <button type="button" className="more-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>More stats</span>
        <span className="muted small">{p.comps.length} {p.comps.length === 1 ? 'competition' : 'competitions'}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && <div className="more-body"><CompTable player={p} /></div>}
    </div>
  );
}

/** Stats by competition. */
function CompTable({ player: p }: { player: Player }) {
  const bowls = p.role === 'BOWL' || p.role === 'AR';
  const bats = p.role !== 'BOWL';
  return (
    <table className="table comp-table">
      <thead>
        <tr>
          <th>Competition</th><th className="r">M</th>
          {bats && <><th className="r">Runs</th><th className="r">SR</th><th className="r">Avg</th></>}
          {bowls && <><th className="r">Wkts</th><th className="r">Econ</th></>}
        </tr>
      </thead>
      <tbody>
        {p.comps.map(c => (
          <tr key={c.name}>
            <td>{c.name}</td><td className="r num">{c.m}</td>
            {bats && <><td className="r num">{c.runs}</td><td className="r num">{c.sr || '0'}</td><td className="r num">{c.avg}</td></>}
            {bowls && <><td className="r num">{c.wickets}</td><td className="r num">{c.econ || '0'}</td></>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Auto-bid: keep bidding for you, one step at a time, up to a price you set. Resets for each player. */
function AutoBid({ state, act }: { state: GameState; act: Act }) {
  const lot = state.lot!;
  const p = playerById[lot.playerId];
  const me = state.settings.team;
  const [limit, setLimit] = useState<number | null>(null);
  const [draft, setDraft] = useState(() => Math.max(p.base, Math.round((p.value * 1.1) / 5) * 5));
  const scheduled = useRef('');
  useEffect(() => { setLimit(null); setDraft(Math.max(p.base, Math.round((p.value * 1.1) / 5) * 5)); }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const amount = nextAmount(state);
  const blocked = bidBlock(state.teams[me], p, amount);
  const canAuto = limit !== null && lot.leader !== me && !state.paused && !state.rtm && !blocked && amount <= limit;
  useEffect(() => {
    if (!canAuto) return;
    const key = `${lot.playerId}:${lot.bid}`;
    if (scheduled.current === key) return;
    scheduled.current = key;
    const t = setTimeout(() => act((s, now) => { if (s.lot?.playerId === lot.playerId && s.lot.leader !== me) placeBid(s, me, now); }), 700 + Math.random() * 600);
    return () => clearTimeout(t);
  }, [canAuto, lot.bid, lot.playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (dir: 1 | -1) => setDraft(d => Math.max(p.base, dir > 0 ? nextBid(d, p.base) : d - (d > 500 ? 25 : d > 200 ? 20 : d > 100 ? 10 : 5)));
  if (limit !== null) {
    const done = amount > limit || Boolean(blocked);
    return (
      <div className={`autobid on${done ? ' done' : ''}`}>
        <span>{done ? <>Auto-bid stopped at <b className="num">{money(limit)}</b></> : <>Auto-bidding up to <b className="num">{money(limit)}</b></>}</span>
        <button type="button" className="btn sm" onClick={() => setLimit(null)}>Stop</button>
      </div>
    );
  }
  return (
    <div className="autobid">
      <span className="small muted">Auto-bid up to</span>
      <span className="autobid-stepper">
        <button type="button" className="btn sm" onClick={() => step(-1)} aria-label="Lower">−</button>
        <b className="num">{money(draft)}</b>
        <button type="button" className="btn sm" onClick={() => step(1)} aria-label="Higher">+</button>
      </span>
      <button type="button" className="btn sm primary" onClick={() => setLimit(draft)}>Start</button>
    </div>
  );
}

function BidPanel({ state, act, outbidBy, call, rating, multi }: {
  state: GameState; act: Act; outbidBy: TeamId | null; call: Call | null; rating: { overall: number; grade: string }; multi?: boolean;
}) {
  const me = state.settings.team;
  const lot = state.lot;
  const p = currentPlayer(state);
  if (!lot || !p) {
    return <div className="stage-narrow"><AuctioneerStage state={state} call={call} compact /></div>;
  }
  const left = state.paused ? state.paused.left : Math.max(0, lot.endsAt - Date.now());
  const secs = Math.ceil(left / 1000);
  const timer = lot.bid === null ? state.settings.timer : RULES.timerAfterBid;
  const amount = nextAmount(state);
  const mine = lot.leader === me;
  const myTeam = state.teams[me];
  const block = mine ? null : bidBlock(myTeam, p, amount);
  const waitingRtm = state.rtm && !state.teams[state.rtm.stage === 'raise' ? state.rtm.buyer : state.rtm.holder].human;
  const maxICanBid = Math.max(0, myTeam.purse - reserveNeeded(myTeam));
  const locked = Boolean(state.paused) || Boolean(state.rtm);

  return (
    <div className={`bidpanel${mine ? ' mine' : ''}`}>
      {mine && <div className="banner win">You have the highest bid</div>}
      {!mine && outbidBy && lot.leader && <div className="banner lose">Outbid by {teamById[lot.leader].name}</div>}
      <div className="row between">
        <div>
          <div className="small muted">{lot.bid === null ? 'Opening bid' : mine ? 'Your bid' : 'Current bid'}</div>
          <div className="price num bump" key={lot.bid ?? 'open'}>{money(lot.bid ?? p.base)}</div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {lot.leader ? (
            <>
              <div style={{ textAlign: 'right' }}>
                <div className="small muted">{mine ? 'Leading' : 'Highest bidder'}</div>
                <b>{mine ? 'You' : teamById[lot.leader].city}</b>
              </div>
              <TeamLogo id={lot.leader} size={44} />
            </>
          ) : <span className="small muted">No bids yet</span>}
        </div>
      </div>
      <div className="row between small muted num">
        <span>{state.paused ? 'Paused' : `${secs} s left`}</span>
        <span>You can spend up to {money(maxICanBid)}</span>
      </div>
      <div className={`clock ${secs <= 3 ? 'low' : secs <= 6 ? 'warn' : 'ok'}`}>
        <div style={{ width: `${Math.min(100, (left / (timer * 1000)) * 100)}%` }} />
      </div>
      <div className="stage-narrow"><AuctioneerStage state={state} call={call} compact /></div>
      <AutoBid state={state} act={act} />
      <Needs state={state} player={p} rating={rating} />
      {waitingRtm && <div className="notice">Waiting for {state.rtm!.stage === 'raise' ? state.rtm!.buyer : state.rtm!.holder} to decide on RTM…</div>}
      <div className="bidbar">
        <button type="button" className={`btn big${mine ? ' leading-btn' : ' primary'}`} style={{ flex: 1 }} disabled={mine || Boolean(block) || locked}
          onClick={() => { primeVoice(); act((s, t) => { placeBid(s, me, t); }); }}>
          {mine ? `Leading at ${money(lot.bid!)}` : block ?? `Bid ${money(amount)}`}
        </button>
        {!multi && (
          <button type="button" className="btn big" disabled={mine || locked} onClick={() => { primeVoice(); act((s, t) => skipLot(s, t)); }}>
            Skip
          </button>
        )}
      </div>
      <p className="hint shortcut-hint">Keys: <kbd>B</kbd> or <kbd>Space</kbd> bid · <kbd>S</kbd> skip · <kbd>P</kbd> pause · <kbd>L</kbd> lists</p>
    </div>
  );
}

/** Phones: one slim line naming the next player. */
/** "CSK · You", "MI · Rahul", or "RCB · Bot" in a friends room. */
function chipLabel(state: GameState, id: TeamId) {
  if (id === state.settings.team) return `${id} · You`;
  const t = state.teams[id];
  if (t.human) return `${id} · ${state.settings.names?.[id] ?? 'Friend'}`;
  return state.settings.names ? `${id} · Bot` : id;
}

/** Friends room part of the menu: who is playing, and (for the host) an invite link for late joiners. */
function RoomMenu({ state, guest }: { state: GameState; guest?: boolean }) {
  const [copied, setCopied] = useState(false);
  const code = guest ? guestRoom()?.code : hostRoom()?.lobby.code;
  const people = TEAM_IDS.filter(id => state.teams[id].human);
  const bots = TEAM_IDS.length - people.length;
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!code) return;
    try { await navigator.clipboard.writeText(inviteLink(code)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  return (
    <>
      <hr />
      <div className="menu-room" onClick={e => e.stopPropagation()}>
        <div className="small muted">Playing in this room</div>
        <ul>
          {people.map(id => (
            <li key={id}><TeamLogo id={id} size={20} /><b>{id}</b><span>{id === state.settings.team ? 'You' : state.settings.names?.[id] ?? 'Friend'}</span></li>
          ))}
        </ul>
        <div className="small muted">{bots} {bots === 1 ? 'team is a bot' : 'teams are bots'}. Friends can still join and take one.</div>
      </div>
      {code && (
        <button type="button" role="menuitem" onClick={copy}>
          {copied ? 'Invite link copied' : `Copy invite link · ${code}`}
        </button>
      )}
    </>
  );
}

function NextLine({ state }: { state: GameState }) {
  const id = state.queue.slice(state.qi + 1).find(x => !state.results[x]);
  if (!id) return null;
  const p = playerById[id];
  const tid = shownTeam(state, p);
  return (
    <div className="next-line">
      <span className="small muted">Next</span>
      <PlayerPhoto player={p} size={22} team={tid} />
      <b className="next-name">{p.name}</b>
      <span className="small muted">{setOf(state, id).code} · {money(p.base)}</span>
      {tid && <TeamLogo id={tid} size={20} />}
    </div>
  );
}

function NextUp({ state }: { state: GameState }) {
  const next = state.queue.slice(state.qi + 1).filter(id => !state.results[id]).slice(0, 3);
  if (!next.length) return null;
  return (
    <div className="card next-up">
      <h3 style={{ padding: '10px 12px 0' }}>Next up</h3>
      <div className="list">
        {next.map(id => {
          const p = playerById[id];
          const tid = shownTeam(state, p);
          return (
            <div key={id} className="list-row">
              <PlayerPhoto player={p} size={28} team={tid} />
              <div className="grow"><div className="name">{p.name}</div><div className="small muted">{setOf(state, id).code} · {roleLabel(p)} · {money(p.base)}</div></div>
              {tid && <TeamLogo id={tid} size={24} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Tab = 'players' | 'teams' | 'squad' | 'log';

function SidePanel({ state, ratings, onOpen }: { state: GameState; ratings: Ratings; onOpen: (t: TeamId) => void }) {
  const [tab, setTab] = useState<Tab>('players');
  const label: Record<Tab, string> = { players: 'Players', teams: 'Teams', squad: 'My squad', log: 'Log' };
  return (
    <>
      <div className="tabs" role="tablist">
        {(Object.keys(label) as Tab[]).map(t => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{label[t]}</button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'players' && <PlayerList state={state} />}
        {tab === 'teams' && <TeamsTable state={state} ratings={ratings} onOpen={onOpen} />}
        {tab === 'squad' && <SquadList state={state} team={state.settings.team} />}
        {tab === 'log' && <div className="list">{state.log.map((l, i) => <div key={i} className="list-row small">{l}</div>)}</div>}
      </div>
    </>
  );
}

function TeamsTable({ state, ratings, onOpen }: { state: GameState; ratings: Ratings; onOpen: (t: TeamId) => void }) {
  const rows = [...TEAM_IDS].sort((a, b) => ratings[b].overall - ratings[a].overall);
  return (
    <table className="table">
      <thead><tr><th>Team</th><th className="r">Rating</th><th className="r">Purse</th><th className="r">Squad</th><th className="r">OS</th></tr></thead>
      <tbody>
        {rows.map(id => {
          const t = state.teams[id];
          return (
            <tr key={id} className={id === state.settings.team ? 'me' : ''} onClick={() => onOpen(id)} style={{ cursor: 'pointer' }}>
              <td><TeamTag id={id} you={id === state.settings.team} /></td>
              <td className="r num"><b>{t.squad.length ? ratings[id].overall : 0}</b> <span className="muted small">{t.squad.length ? ratings[id].grade : ''}</span></td>
              <td className="r num">{money(t.purse)}</td>
              <td className="r num">{t.squad.length}</td>
              <td className="r num">{overseasCount(t)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type Filter = 'all' | 'upcoming' | 'sold' | 'unsold';

/** Players grouped by auction set, each set collapsible. The current set opens by itself. */
function PlayerList({ state }: { state: GameState }) {
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [q, setQ] = useState('');
  const curSet = state.lot ? setOf(state, state.lot.playerId).code : state.intro?.set;
  const [open, setOpen] = useState<Set<string>>(() => new Set(curSet ? [curSet] : []));
  useEffect(() => { if (curSet) setOpen(o => (o.has(curSet) ? o : new Set([...o, curSet]))); }, [curSet]);

  const groups = useMemo(() => {
    const cur = state.lot?.playerId;
    const out: { code: string; name: string; rows: { p: Player; r: GameState['results'][string]; cur: boolean }[]; left: number; total: number }[] = [];
    const byCode = new Map<string, (typeof out)[number] & { order: number }>();
    state.queue.forEach((id, i) => {
      const set = setOf(state, id);
      let g = byCode.get(set.code);
      if (!g) { g = { code: set.code, name: set.name, rows: [], left: 0, total: 0, order: set.order }; byCode.set(set.code, g); out.push(g); }
      const r = state.results[id];
      g.total++;
      if (!r) g.left++;
      const keep = filter === 'sold' ? r?.status === 'sold'
        : filter === 'unsold' ? r?.status === 'unsold'
        : filter === 'upcoming' ? !r && (i >= state.qi || id === cur)
        : true;
      if (keep && (!q || playerById[id].name.toLowerCase().includes(q.toLowerCase()))) g.rows.push({ p: playerById[id], r, cur: id === cur });
    });
    return out.sort((x, y) => byCode.get(x.code)!.order - byCode.get(y.code)!.order).filter(g => g.rows.length);
  }, [state.queue, state.results, state.qi, state.lot?.playerId, filter, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (code: string) => setOpen(o => { const n = new Set(o); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const allOpen = groups.length > 0 && groups.every(g => open.has(g.code));

  return (
    <>
      <div className="filters">
        <input className="input" style={{ minHeight: 36 }} placeholder="Search players" value={q} onChange={e => setQ(e.target.value)} />
        {(['upcoming', 'sold', 'unsold', 'all'] as Filter[]).map(f => (
          <button key={f} type="button" className={`btn sm${filter === f ? ' primary' : ''}`} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
        <button type="button" className="btn sm ghost" onClick={() => setOpen(allOpen ? new Set(curSet ? [curSet] : []) : new Set(groups.map(g => g.code)))}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      <div className="list">
        {groups.map(g => {
          const isOpen = open.has(g.code) || Boolean(q);
          const isCur = g.code === curSet;
          return (
            <section key={g.code} className={`set-group${isCur ? ' current' : ''}`}>
              <button type="button" className="set-head" aria-expanded={isOpen} onClick={() => toggle(g.code)}>
                <span className="set-chip" style={setStyle(g.code)}>{g.code}</span>
                <span className="grow">
                  <span className="set-title">{g.name}</span>
                  <span className="small muted">{g.total} players · {g.left} left{isCur ? ' · on now' : ''}</span>
                </span>
                <span className="chev" aria-hidden>{isOpen ? '−' : '+'}</span>
              </button>
              {isOpen && g.rows.map(({ p, r, cur }) => {
                const tid = shownTeam(state, p);
                return (
                  <div key={p.id} className={`list-row${cur ? ' current' : ''}`}>
                    <PlayerPhoto player={p} size={32} team={tid} />
                    <div className="grow">
                      <div className="name">{p.name}</div>
                      <div className="small muted">{roleLabel(p)}{p.overseas ? ` · ${p.country}` : ''} · {money(p.base)}</div>
                    </div>
                    {cur && <span className="tag">Now</span>}
                    {r?.status === 'sold'
                      ? <><TeamLogo id={r.team!} size={26} /><span className="small num">{money(r.price!)}</span></>
                      : r?.status === 'unsold'
                        ? <span className="tag unsold">Unsold</span>
                        : tid && <TeamLogo id={tid} size={22} />}
                  </div>
                );
              })}
            </section>
          );
        })}
        {!groups.length && <div className="list-row muted small">No players here.</div>}
      </div>
    </>
  );
}

type SquadFilter = 'all' | Role;
const SQUAD_GROUPS: [Role, string][] = [['BAT', 'Batters'], ['WK', 'Wicket-keepers'], ['AR', 'All-rounders'], ['BOWL', 'Bowlers']];

/** A team's squad: filter pills, role sections, round photos with name and price. */
export function SquadList({ state, team }: { state: GameState; team: TeamId }) {
  const t = state.teams[team];
  const [filter, setFilter] = useState<SquadFilter>('all');
  const spent = t.squad.reduce((a, e) => a + e.price, 0);
  const r = t.squad.length ? squadReport(t, { live: state.phase !== 'done' }) : null;
  const groups = SQUAD_GROUPS.filter(([g]) => filter === 'all' || filter === g);
  return (
    <div className="squad-view">
      <div className="squad-head">
        <b>{teamById[team].id} squad</b>
        <span className="small muted num">
          {r ? `Rating ${r.overall} ${r.grade} · ` : ''}{t.squad.length}/{RULES.squadMax} · {overseasCount(t)}/{RULES.overseasMax} overseas · spent {money(spent)} · left {money(t.purse)}
        </span>
      </div>
      <div className="squad-pills" role="tablist">
        {([['all', 'Team'], ...SQUAD_GROUPS] as [SquadFilter, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {groups.map(([g, name]) => {
        const list = t.squad.filter(e => playerById[e.id].role === g);
        if (!list.length && filter === 'all') return null;
        return (
          <section key={g} className="squad-group">
            <h4 className="squad-title"><span>{name}</span><span className="small muted num">{list.length}</span></h4>
            {list.length ? (
              <div className="squad-grid">
                {list.map(e => {
                  const p = playerById[e.id];
                  return (
                    <div key={e.id} className="squad-player" title={`${p.name} · ${roleLabel(p)} · ${money(e.price)}`}>
                      <span className="squad-photo">
                        <PlayerPhoto player={p} size={58} team={team} />
                        {p.overseas && (
                          <span className="os-badge" aria-label="Overseas">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" /></svg>
                          </span>
                        )}
                      </span>
                      <span className="squad-name">{p.name}</span>
                      <span className="squad-price num">{money(e.price)}{e.how === 'retained' ? ' · kept' : e.how === 'rtm' ? ' · RTM' : ''}</span>
                    </div>
                  );
                })}
              </div>
            ) : <p className="small muted">No {name.toLowerCase()} yet.</p>}
          </section>
        );
      })}
      {!t.squad.length && <p className="small muted">No players yet.</p>}
    </div>
  );
}

function RtmDialog({ state, act }: { state: GameState; act: Act }) {
  const o = state.rtm;
  const me = state.settings.team;
  const p = o ? playerById[o.playerId] : null;
  const minRaise = o && p ? nextBid(o.price, p.base) : 0;
  const [raise, setRaise] = useState(0);
  if (!o || !p) return null;
  const decider = o.stage === 'raise' ? o.buyer : o.holder;
  if (decider !== me) return null;
  const amount = Math.max(raise, minRaise);
  const step = (dir: 1 | -1) => setRaise(Math.max(minRaise, dir > 0 ? nextBid(amount, p.base) : amount - (amount > 500 ? 25 : amount > 200 ? 20 : 10)));
  const other = o.stage === 'raise' ? o.holder : o.buyer;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Right to match">
      <div className="dialog">
        <div className="row"><PlayerPhoto player={p} size={48} /><div style={{ flex: 1 }}><h2>{p.name}</h2><div className="muted small">{roleLabel(p)}</div></div><TeamLogo id={other} size={40} /></div>
        {o.stage === 'match' && (
          <>
            <p>{teamById[o.buyer].name} bought him for <b>{money(o.price)}</b>. Use an RTM card to match? You have {state.teams[me].rtm} left.</p>
            <button className="btn primary big block" onClick={() => act((s, t) => rtmAnswer(s, true, t))}>Use RTM at {money(o.price)}</button>
            <button className="btn block" onClick={() => act((s, t) => rtmAnswer(s, false, t))}>Let him go</button>
          </>
        )}
        {o.stage === 'raise' && (
          <>
            <p>{teamById[o.holder].name} matched your bid of <b>{money(o.price)}</b> with RTM. You get one final raise.</p>
            <div className="stepper">
              <button className="btn" onClick={() => step(-1)} aria-label="Lower">−</button>
              <div className="price num">{money(amount)}</div>
              <button className="btn" onClick={() => step(1)} aria-label="Higher">+</button>
            </div>
            <button className="btn primary big block" disabled={Boolean(bidBlock(state.teams[me], p, amount))}
              onClick={() => { act((s, t) => rtmRaise(s, amount, t)); setRaise(0); }}>Raise to {money(amount)}</button>
            <button className="btn block" onClick={() => act((s, t) => rtmRaise(s, null, t))}>No raise</button>
          </>
        )}
        {o.stage === 'final' && (
          <>
            <p>{teamById[o.buyer].name} raised to <b>{money(o.price)}</b>. Match it to keep him?</p>
            <button className="btn primary big block" onClick={() => act((s, t) => rtmAnswer(s, true, t))}>Match {money(o.price)}</button>
            <button className="btn block" onClick={() => act((s, t) => rtmAnswer(s, false, t))}>Let him go</button>
          </>
        )}
      </div>
    </div>
  );
}
