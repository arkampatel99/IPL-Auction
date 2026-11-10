import { useEffect, useMemo, useState } from 'react';
import { teamById } from '../data/teams';
import { playerById, roleLabel } from '../game/players';
import type { GameState } from '../game/engine';
import { PlayerPhoto, TeamLogo, money } from '../ui/common';

/** Price that counts up to the final amount. */
function CountUp({ to }: { to: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      setV(Math.round((to * (1 - Math.pow(1 - k, 3))) / 5) * 5);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{money(Math.max(5, v))}</>;
}

/** Full-screen moment after each result: player card, SOLD stamp, confetti in team colours. */
export default function SoldPopup({ state }: { state: GameState }) {
  const e = state.lastEvent;
  const key = e ? `${e.playerId}:${e.result.status}` : '';
  const mineBuy = e?.result.status === 'sold' && e.result.team === state.settings.team;
  const pieces = useMemo(() => Array.from({ length: mineBuy ? 140 : 70 }, () => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.5,
    dur: 2.2 + Math.random() * 1.8,
    drift: (Math.random() - 0.5) * 240,
    spin: (Math.random() - 0.5) * 1080,
    w: 6 + Math.random() * 8,
    h: 10 + Math.random() * 10,
    shade: Math.floor(Math.random() * 4),
  })), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!e || state.lot || !state.hold || state.intro) return null;
  const p = playerById[e.playerId];

  if (e.result.status === 'unsold') {
    return (
      <div className="pop pop-unsold" key={key} role="status">
        <div className="pop-card small">
          <PlayerPhoto player={p} size={96} />
          <div className="pop-name">{p.name}</div>
          <div className="pop-sub">{roleLabel(p)} · base {money(p.base)}</div>
          <div className="pop-stamp unsold">Unsold</div>
        </div>
      </div>
    );
  }

  const t = teamById[e.result.team!];
  const mine = e.result.team === state.settings.team;
  const colours = [t.color, t.ink, '#F9CD05', '#FFFFFF'];
  return (
    <div className={`pop${mine ? ' pop-mine' : ''}`} key={key} role="status" style={{ ['--team' as string]: t.color, ['--team-ink' as string]: t.ink }}>
      <div className="pop-wash" />
      <div className="confetti" aria-hidden>
        {pieces.map((c, i) => (
          <i key={i} style={{
            left: `${c.left}%`, width: c.w, height: c.h, background: colours[c.shade],
            animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`,
            ['--drift' as string]: `${c.drift}px`, ['--spin' as string]: `${c.spin}deg`,
          }} />
        ))}
      </div>
      <div className="pop-card">
        <div className="pop-band" />
        {mine && <div className="pop-welcome">Welcome to {t.city}!</div>}
        <div className="pop-logo"><TeamLogo id={t.id} size={64} /></div>
        <div className="pop-photo"><PlayerPhoto player={p} size={150} team={t.id} /></div>
        <div className="pop-name">{p.name}</div>
        <div className="pop-sub">{roleLabel(p)} · {p.overseas ? p.country : 'India'}</div>
        <div className="pop-to">{mine ? 'Joins your team' : `to ${t.name}`}{e.result.how === 'rtm' ? ' · RTM' : ''}</div>
        <div className="pop-price num"><CountUp to={e.result.price!} /></div>
        <div className="pop-chant">{t.chant}</div>
        <div className="pop-stamp">Sold</div>
      </div>
    </div>
  );
}
