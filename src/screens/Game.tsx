import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useGame } from './useGame';
import { useTeamTheme } from '../ui/theme';
import { botConfirmSquad, confirmSquad, placeBid, rtmAnswer, rtmRaise, squadsPending, startWhenReady } from '../game/engine';
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
    const me = state.settings.team;
    const confirm = (ids: string[]) => act((s, now) => { if (confirmSquad(s, me, ids)) startWhenReady(s, now); });
    const startAnyway = () => act((s, now) => { for (const id of squadsPending(s)) botConfirmSquad(s, id); startWhenReady(s, now); });
    const Step = state.settings.mode === 'mini' ? Release : Retention;
    return <Step state={state} confirm={confirm} startAnyway={startAnyway} />;
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
      if (msg.t === 'squad') { if (confirmSquad(s, team, msg.ids)) startWhenReady(s, now); return; }
      if (msg.t === 'bid') placeBid(s, team, now);
      const o = s.rtm;
      if (!o) return;
      if (msg.t === 'rtm' && o.stage !== 'raise' && o.holder === team) rtmAnswer(s, msg.yes, now);
      if (msg.t === 'raise' && o.stage === 'raise' && o.buyer === team) rtmRaise(s, msg.amount, now);
    });
    // Late joiner takes a bot's team; a friend who leaves hands theirs back to a bot.
    room.onJoin = (team, name) => {
      const s = latest.current;
      if (!s || s.phase === 'done' || s.teams[team].human) return false;
      act(st => {
        // Joining while squads are being picked: that team's bot choice stands.
        if (st.phase === 'retention') (st.ready ??= []).includes(team) || st.ready.push(team);
        st.teams[team].human = true;
        delete st.teams[team].out; delete st.teams[team].left;
        st.settings.humans = [...new Set([...(st.settings.humans ?? [st.settings.team]), team])];
        st.settings.names = { ...st.settings.names, [team]: name };
      });
      return true;
    };
    room.onLeave = team => act((st, now) => {
      if (team === st.settings.team) return;
      botConfirmSquad(st, team);
      st.teams[team].human = false;
      // No bots in this room: the team stops bidding (its squad so far stays).
      if (st.settings.bots === false) { st.teams[team].out = true; st.teams[team].left = true; }
      st.settings.humans = (st.settings.humans ?? []).filter(t => t !== team);
      const names = { ...st.settings.names };
      delete names[team];
      st.settings.names = names;
      startWhenReady(st, now);
    });
    return () => { room.onAction = undefined; room.onJoin = undefined; room.onLeave = undefined; };
  }, [act]);
}
