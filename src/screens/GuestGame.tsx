import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { teamById, type TeamId } from '../data/teams';
import type { GameState } from '../game/engine';
import { TopBar } from '../ui/common';
import { useTeamTheme } from '../ui/theme';
import { guestRoom, joinRoom, type GuestRoom } from '../net/room';
import Auction from './Auction';
import Results from './Results';
import { SeatGrid } from './Friends';
import type { Act } from './Game';

const NAME_KEY = 'ipl-auction-name';
const savedName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };

/** A friend's view: join by link or code, pick a team, then follow the host's auction live. */
export default function GuestGame() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const [name, setName] = useState(savedName());
  const [room, setRoom] = useState<GuestRoom | null>(() => {
    const r = guestRoom();
    return r && r.code === code.toUpperCase() ? r : null;
  });
  const [, setV] = useState(0);
  useEffect(() => {
    if (!room) return;
    const f = () => setV(v => v + 1);
    room.listeners.add(f);
    return () => { room.listeners.delete(f); };
  }, [room]);

  const myTeam = room?.lobby ? (Object.entries(room.lobby.seats).find(([, s]) => s!.peer === room.me)?.[0] as TeamId | undefined) ?? null : null;
  useTeamTheme(myTeam);

  // This viewer's copy of the host's state: "me" is my team.
  const view: GameState | null = useMemo(() => {
    if (!room?.state || !myTeam) return null;
    return { ...room.state, settings: { ...room.state.settings, team: myTeam } };
  }, [room?.state, myTeam]); // eslint-disable-line react-hooks/exhaustive-deps

  const act: Act = useMemo(() => makeGuestAct(() => view, () => room, myTeam), [view, room, myTeam]);

  // 1. Name, then connect.
  if (!room) {
    return (
      <>
        <TopBar back="/friends" />
        <main className="page stack">
          <div className="hero">
            <h1>Join room {code.toUpperCase()}</h1>
            <p className="muted">Enter the name your friends will see.</p>
          </div>
          <input className="input" value={name} maxLength={20} placeholder="Your name" onChange={e => setName(e.target.value)} />
          <button type="button" className="btn primary big block" disabled={!name.trim()} onClick={() => {
            try { localStorage.setItem(NAME_KEY, name.trim()); } catch { /* storage off */ }
            setRoom(joinRoom(code, name.trim()));
          }}>Join</button>
        </main>
      </>
    );
  }

  // 2. Live auction from the host.
  if (view) {
    if (view.phase === 'done') return <Results state={view} />;
    if (view.phase === 'retention') return <Waiting text="The host is getting their squad ready…" />;
    return <Auction state={view} act={act} guest />;
  }

  // 3. Lobby: pick a free team and wait for the host, or join a running auction by taking a bot's team.
  const lobby = room.lobby;
  const late = Boolean(lobby?.started);
  const retry = () => { room.close(); setRoom(joinRoom(code, name.trim() || savedName() || 'Friend')); };
  return (
    <>
      <TopBar back="/friends" />
      <main className="page stack">
        <div className="hero">
          <h1>{lobby ? `${lobby.host}'s room` : room.error ? 'Not connected' : 'Connecting…'}</h1>
          <p className="muted">
            {!lobby ? (room.error ? `Room ${code.toUpperCase()}` : `Joining room ${code.toUpperCase()}${room.attempt > 1 ? ` · try ${room.attempt} of 3` : ''}…`)
              : late ? (myTeam ? `You're ${teamById[myTeam].name}. Joining the auction…` : 'The auction is on. Pick a bot team to take it over from here.')
              : myTeam ? `You're ${teamById[myTeam].name}. Waiting for the host to start.` : 'Pick a free team.'}
          </p>
        </div>
        {room.error && <p className="status err" role="alert">{room.error}</p>}
        {lobby && <SeatGrid seats={lobby.seats} mine={myTeam} late={late} onPick={late && myTeam ? undefined : t => room.send({ t: 'pick', team: t })} />}
        {room.error && (
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn primary" style={{ flex: 1 }} onClick={retry}>Try again</button>
            <button type="button" className="btn" style={{ flex: 1 }} onClick={() => { room.close(); nav('/friends'); }}>Back</button>
          </div>
        )}
      </main>
    </>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <>
      <TopBar />
      <main className="page stack"><div className="hero"><h1>Almost ready</h1><p className="muted">{text}</p></div></main>
    </>
  );
}

/**
 * The auction screen calls act(fn) with engine actions. A guest can't run the engine, so we try the
 * action on a copy of the state, see what it did (a bid, an RTM answer, a raise) and send that to the host.
 */
function makeGuestAct(getView: () => GameState | null, getRoom: () => GuestRoom | null, me: TeamId | null): Act {
  return fn => {
    const before = getView();
    const room = getRoom();
    if (!before || !room || !me) return;
    const after = structuredClone(before);
    fn(after, Date.now());
    const b = before.lot, a = after.lot;
    if (b && a && a.playerId === b.playerId && a.leader === me && a.bid !== b.bid) { room.send({ t: 'bid' }); return; }
    const o = before.rtm;
    if (o) {
      const decider = o.stage === 'raise' ? o.buyer : o.holder;
      if (decider !== me) return;
      const changed = after.rtm?.stage !== o.stage || after.rtm?.price !== o.price || !after.rtm;
      if (!changed) return;
      if (o.stage === 'raise') room.send({ t: 'raise', amount: after.rtm && after.rtm.price > o.price ? after.rtm.price : null });
      else room.send({ t: 'rtm', yes: Boolean(after.rtm) || after.results[o.playerId]?.team === me });
    }
  };
}
