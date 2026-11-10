import { useCallback, useEffect, useState } from 'react';
import type { GameState } from '../game/engine';
import { tick } from '../game/engine';

const KEY = 'ipl-auction-save-v1';

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as GameState) : null;
    return s?.v === 2 && (s.phase === 'retention' || s.sets) ? s : null;
  } catch { return null; }
}

export function saveGame(s: GameState | null) {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* storage off */ }
}

/** Holds the game, runs the clock + bots, and saves after every change. */
export function useGame() {
  const [state, setState] = useState<GameState | null>(() => {
    const s = loadGame();
    // Coming back to a saved game: pause it so the clock doesn't run out while away.
    if (s && s.phase === 'auction' && s.lot && !s.paused) s.paused = { left: Math.max(5000, s.lot.endsAt - Date.now()) };
    return s;
  });

  /** Apply an engine action to a copy of the state. */
  const act = useCallback((fn: (s: GameState, now: number) => unknown) => {
    setState(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next, Date.now());
      return next;
    });
  }, []);

  useEffect(() => {
    if (!state || state.phase !== 'auction' || state.paused) return;
    const t = setInterval(() => act((s, now) => tick(s, now)), 200);
    return () => clearInterval(t);
  }, [state?.phase, state?.paused, act]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { saveGame(state); }, [state]);

  return { state, act };
}
