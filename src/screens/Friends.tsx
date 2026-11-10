import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TEAMS, teamById, type TeamId } from '../data/teams';
import { RULES, type AuctionMode, type BotLevel } from '../game/rules';
import { createGame } from '../game/engine';
import { Segmented, TeamLogo, TeamTag, TopBar } from '../ui/common';
import { useTeamTheme } from '../ui/theme';
import { createRoom, hostRoom, inviteLink, type Seat } from '../net/room';
import { saveGame } from './useGame';

const NAME_KEY = 'ipl-auction-name';

/** "Empty teams" choice: no bots, or bots at a level. */
type Empties = 'none' | BotLevel;
const EMPTY_OPTIONS: { value: Empties; label: string }[] = [
  { value: 'none', label: 'No bots' }, { value: 'easy', label: 'Easy bots' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' },
];
const emptiesOf = (s: { level: BotLevel; bots?: boolean }): Empties => (s.bots === false ? 'none' : s.level);
const withEmpties = <T extends { level: BotLevel; bots?: boolean }>(s: T, e: Empties): T => ({ ...s, level: e === 'none' ? s.level : e, bots: e !== 'none' });
const savedName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };
const keepName = (n: string) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* storage off */ } };

/** Play with Friends: create a room, or join one with a code. */
export default function Friends() {
  const nav = useNavigate();
  const [name, setName] = useState(savedName());
  const [team, setTeam] = useState<TeamId>('CSK');
  const [mode, setMode] = useState<AuctionMode>('mini');
  const [empties, setEmpties] = useState<Empties>('medium');
  const [length, setLength] = useState<'quick' | 'full'>('quick');
  const [timer, setTimer] = useState(15);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useTeamTheme(team);

  const create = async () => {
    if (!name.trim()) { setError('Enter your name first.'); return; }
    keepName(name.trim());
    setBusy(true); setError('');
    try {
      hostRoom()?.close();
      await createRoom(name.trim(), team, withEmpties({ mode, level: 'medium' as BotLevel, length, timer }, empties));
      nav('/room');
    } catch {
      setError('Could not create a room. Check your internet and try again.');
    } finally { setBusy(false); }
  };
  const join = () => {
    const c = code.trim().toUpperCase();
    if (!name.trim()) { setError('Enter your name first.'); return; }
    if (!/^[A-Z0-9]{6}$/.test(c)) { setError('Room codes have 6 letters or numbers.'); return; }
    keepName(name.trim());
    nav(`/r/${c}`, { state: { join: name.trim() } });
  };

  return (
    <>
      <TopBar back="/" />
      <main className="page stack setup">
        <div className="hero full">
          <h1>Play with Friends</h1>
          <p className="muted">Create a room and share the link, or join with a code.</p>
        </div>

        <section className="section full">
          <h3>Your name</h3>
          <input className="input" value={name} maxLength={20} placeholder="Name your friends will see" onChange={e => setName(e.target.value)} />
        </section>

        <section className="section card pad join-card full">
          <h3>Join a room</h3>
          <div className="row" style={{ gap: 8 }}>
            <input className="input code-input" value={code} maxLength={6} placeholder="Room code" onChange={e => setCode(e.target.value.toUpperCase())} />
            <button type="button" className="btn primary" onClick={join}>Join</button>
          </div>
        </section>

        <section className="section full">
          <h3>Or create one · your team</h3>
          <div className="teams-grid">
            {TEAMS.map(t => (
              <button key={t.id} type="button" className="team-tile" aria-pressed={t.id === team} onClick={() => setTeam(t.id)} aria-label={t.name}>
                <span className="bar" style={{ background: t.color }} />
                <span className="tile-logo"><TeamLogo id={t.id} size={40} /></span>
                <span className="code">{t.id}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="section">
          <h3>Auction</h3>
          <Segmented label="Auction type" value={mode} onChange={setMode} options={[{ value: 'mega', label: 'Mega' }, { value: 'mini', label: 'Mini' }]} />
        </section>
        <section className="section">
          <h3>Teams nobody picks</h3>
          <Segmented label="Teams nobody picks" value={empties} onChange={setEmpties} options={EMPTY_OPTIONS} />
          <p className="hint">{empties === 'none' ? 'Only people play. Free teams sit out, and friends can still join and take one.' : 'Bots play every team nobody picks.'}</p>
        </section>
        <section className="section">
          <h3>Length</h3>
          <Segmented label="Length" value={length} onChange={setLength}
            options={[{ value: 'quick', label: 'Quick' }, { value: 'full', label: 'Full' }]} />
        </section>
        <section className="section">
          <h3>Time per bid</h3>
          <Segmented label="Time per bid" value={timer} onChange={setTimer} options={RULES.timerChoices.map(t => ({ value: t, label: `${t} s` }))} />
        </section>

        {error && <p className="status err full" role="alert">{error}</p>}
        <button type="button" className="btn primary big block full" disabled={busy} onClick={create}>{busy ? 'Creating room…' : 'Create room'}</button>
      </main>
    </>
  );
}

/** Host's lobby: share the code, see who joined, start the auction. */
export function HostLobby() {
  const nav = useNavigate();
  const room = hostRoom();
  const [, setV] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!room) return;
    const f = () => setV(v => v + 1);
    room.listeners.add(f);
    return () => { room.listeners.delete(f); };
  }, [room]);
  const hostTeam = room ? (Object.entries(room.lobby.seats).find(([, s]) => s!.peer === 'host')?.[0] as TeamId) : null;
  useTeamTheme(hostTeam);
  if (!room || !hostTeam) {
    return (
      <>
        <TopBar back="/friends" />
        <main className="page stack"><div className="hero"><h1>No room open</h1><p className="muted">Create a room first.</p></div></main>
      </>
    );
  }
  const link = inviteLink(room.lobby.code);
  const seats = room.lobby.seats;
  const people = Object.keys(seats).length;
  const noBots = room.lobby.settings.bots === false;
  const setEmpties = (e: Empties) => { room.lobby.settings = withEmpties(room.lobby.settings, e); room.sendLobby(); };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } };
  const start = () => {
    const humans = Object.keys(seats) as TeamId[];
    const names = Object.fromEntries(Object.entries(seats).map(([t, s]) => [t, s!.name]));
    saveGame(createGame({ ...room.lobby.settings, team: hostTeam, humans, names, seed: Math.floor(Math.random() * 2 ** 31) }));
    room.lobby.started = true;
    room.sendLobby();
    nav('/game');
  };

  return (
    <>
      <TopBar back="/friends"><TeamTag id={hostTeam} you /></TopBar>
      <main className="page stack">
        <div className="hero">
          <h1>Your room</h1>
          <p className="muted">Share the code or link. Friends pick a free team.</p>
        </div>
        <div className="card pad room-code-card">
          <div className="small muted">Room code</div>
          <div className="room-code num">{room.lobby.code}</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={copy}>{copied ? 'Link copied' : 'Copy invite link'}</button>
            <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(`Join my IPL auction: ${link}`)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
          </div>
        </div>
        <section className="section">
          <h3>Teams nobody picks</h3>
          <Segmented label="Teams nobody picks" value={emptiesOf(room.lobby.settings)} onChange={setEmpties} options={EMPTY_OPTIONS} />
        </section>
        <SeatGrid seats={seats} bots={!noBots} />
        <button type="button" className="btn primary big block" onClick={start}>
          Start auction · {people} {people === 1 ? 'person' : 'people'}{noBots ? ', no bots' : `, ${10 - people} bots`}
        </button>
        {noBots && people < 2 && <p className="hint" style={{ textAlign: 'center' }}>Waiting for friends? You can start now: they can still join during the auction.</p>}
      </main>
    </>
  );
}

/** Ten team tiles showing who has each team. Pass onPick to let a guest choose a free one. */
export function SeatGrid({ seats, onPick, mine, late, myName, myCid, bots = true }: {
  seats: Partial<Record<TeamId, Seat>>; onPick?: (t: TeamId) => void; mine?: TeamId | null; late?: boolean;
  /** My name: a seat held under it (my old connection) can be taken back. */
  myName?: string;
  myCid?: string;
  /** False when teams nobody picks sit out instead of being played by bots. */
  bots?: boolean;
}) {
  return (
    <div className="seat-grid">
      {TEAMS.map(t => {
        const s = seats[t.id];
        const free = !s;
        const mineBefore = Boolean(s && s.peer !== 'host' && !mine && myCid && s.cid === myCid);
        void myName;
        return (
          <button key={t.id} type="button" className={`seat${free ? ' free' : ''}${mine === t.id ? ' mine' : ''}`} disabled={!onPick || (!free && mine !== t.id && !mineBefore)}
            onClick={() => onPick?.(t.id)} style={{ ['--team' as string]: t.color }}>
            <TeamLogo id={t.id} size={32} />
            <span className="seat-text">
              <b>{t.id}</b>
              <span className="small muted">{s ? (s.peer === 'host' ? `${s.name} (host)` : mineBefore && onPick ? `${s.name} · tap to rejoin` : s.away ? `${s.name} · away` : s.name) : onPick ? (late ? (bots ? 'Bot · tap to play' : 'Free · tap to play') : 'Tap to pick') : (bots ? 'Bot' : 'Free')}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export { teamById };
