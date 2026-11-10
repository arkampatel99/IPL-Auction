import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useGame } from './useGame';
import { useTeamTheme } from '../ui/theme';
import { placeBid, rtmAnswer, rtmRaise } from '../game/engine';
import { hostRoom } from '../net/room';
import Retention from './Retention';
import Release from './Release';
import Auction from './Auction';
import Results from './Results';

export default function Game() {
  const { state, act } = useGame();
  useTeamTheme(state?.settings.team);
  useHostRoom(state, act);
  if (!state) return <Navigate to="/" replace />;
  if (state.phase === 'retention') {
    return state.settings.mode === 'mini' ? <Release state={state} act={act} /> : <Retention state={state} act={act} />;
  }
  if (state.phase === 'done') return <Results state={state} />;
  return <Auction state={state} act={act} />;
}

export type Act = ReturnType<typeof useGame>['act'];

/** Hosting a friends room: send the live state to guests (at most 5 times a second) and apply their actions. */
function useHostRoom(state: ReturnType<typeof useGame>['state'], act: Act) {
  const lastSent = useRef(0);
  const pending = useRef<number | null>(null);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const room = hostRoom();
    if (!room || !room.lobby.started || !state) return;
    const send = () => { pending.current = null; lastSent.current = Date.now(); if (latest.current) room.sendState(latest.current); };
    const wait = 200 - (Date.now() - lastSent.current);
    if (wait <= 0) send();
    else if (pending.current === null) pending.current = window.setTimeout(send, wait);
  }, [state]);

  useEffect(() => {
    const room = hostRoom();
    if (!room) return;
    room.onAction = (team, msg) => act((s, now) => {
      if (msg.t === 'bid') placeBid(s, team, now);
      const o = s.rtm;
      if (!o) return;
      if (msg.t === 'rtm' && o.stage !== 'raise' && o.holder === team) rtmAnswer(s, msg.yes, now);
      if (msg.t === 'raise' && o.stage === 'raise' && o.buyer === team) rtmRaise(s, msg.amount, now);
    });
    return () => { room.onAction = undefined; };
  }, [act]);
}
