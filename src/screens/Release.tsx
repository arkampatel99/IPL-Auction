import { useState } from 'react';
import { RULES } from '../game/rules';
import { playerById, roleLabel, type Role } from '../game/players';
import { overseasCount, releasePlayers, startAuction, type GameState } from '../game/engine';
import { PlayerPhoto, TeamTag, TopBar, money } from '../ui/common';
import type { Act } from './Game';

const GROUPS: [Role, string][] = [['BAT', 'Batters'], ['WK', 'Wicket-keepers'], ['AR', 'All-rounders'], ['BOWL', 'Bowlers']];

/** Mini auction, step 1: release players you don't want. Their salary goes back into your purse. */
export default function Release({ state, act }: { state: GameState; act: Act }) {
  const me = state.settings.team;
  const t = state.teams[me];
  const [out, setOut] = useState<string[]>([]);
  const freed = t.squad.filter(e => out.includes(e.id)).reduce((a, e) => a + e.price, 0);
  const left = t.squad.length - out.length;
  const osLeft = overseasCount(t) - out.filter(id => playerById[id].overseas).length;
  const toggle = (id: string) => setOut(o => (o.includes(id) ? o.filter(x => x !== id) : [...o, id]));
  const start = () => act((s, now) => { releasePlayers(s, me, out); startAuction(s, now); });

  return (
    <>
      <TopBar back="/bots"><TeamTag id={me} you /></TopBar>
      <main className="page stack" style={{ paddingBottom: 120 }}>
        <div className="hero">
          <h1>Release players</h1>
          <p className="muted">Released players free their salary and go to auction first.</p>
        </div>

        <div className="card pad release-summary">
          <div><div className="small muted">Purse</div><div className="price num">{money(t.purse + freed)}</div>
            {freed > 0 && <div className="small" style={{ color: 'var(--sold)' }}>+{money(freed)} freed</div>}</div>
          <div><div className="small muted">Squad</div><div className="price num">{left}/{RULES.squadMax}</div>
            <div className="small muted">{RULES.squadMax - left} slots to fill</div></div>
          <div><div className="small muted">Overseas</div><div className="price num">{osLeft}/{RULES.overseasMax}</div></div>
        </div>

        {GROUPS.map(([role, name]) => {
          const rows = t.squad.filter(e => playerById[e.id].role === role).sort((a, b) => b.price - a.price);
          if (!rows.length) return null;
          return (
            <section key={role} className="section">
              <h3>{name} · {rows.length}</h3>
              <div className="card list">
                {rows.map(e => {
                  const p = playerById[e.id];
                  const gone = out.includes(e.id);
                  return (
                    <div key={e.id} className={`list-row${gone ? ' released' : ''}`}>
                      <PlayerPhoto player={p} size={40} team={me} />
                      <div className="grow">
                        <div className="name">{p.name}</div>
                        <div className="small muted">{roleLabel(p)}{p.overseas ? ` · ${p.country}` : ''} · Rating {p.rating} · salary {money(e.price)}</div>
                      </div>
                      <button type="button" className={`btn sm${gone ? ' primary' : ''}`} onClick={() => toggle(e.id)}>
                        {gone ? 'Undo' : 'Release'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>
      <div className="bottom-cta">
        <div style={{ maxWidth: 608, margin: '0 auto' }}>
          <button type="button" className="btn primary big block" onClick={start}>
            {out.length ? `Release ${out.length} and start auction` : 'Keep everyone and start auction'}
          </button>
        </div>
      </div>
    </>
  );
}
