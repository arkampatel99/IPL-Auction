import { useState } from 'react';
import { TEAM_IDS, teamById } from '../data/teams';
import { RULES } from '../game/rules';
import { playerById, roleLabel } from '../game/players';
import { applyRetention, retainable, retentionError, retentionPlan, startAuction, type GameState } from '../game/engine';
import { PlayerPhoto, TeamLogo, TeamTag, TopBar, money } from '../ui/common';
import type { Act } from './Game';

export default function Retention({ state, act }: { state: GameState; act: Act }) {
  const me = state.settings.team;
  const [picked, setPicked] = useState<string[]>([]);
  const plan = retentionPlan(picked);
  const cost = plan.reduce((a, b) => a + b.cost, 0);
  const options = retainable(me);

  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id];
    if (!retentionError(next)) setPicked(next);
  };
  const blocked = (id: string) => !picked.includes(id) && retentionError([...picked, id]) !== null;

  const confirm = () => act((s, now) => { applyRetention(s, me, picked); startAuction(s, now); });

  return (
    <>
      <TopBar back="/bots"><TeamTag id={me} you /></TopBar>
      <main className="page stack" style={{ paddingBottom: 120 }}>
        <div className="hero">
          <h1>Retain players</h1>
          <p className="muted">
            Up to {RULES.maxRetentions} players · capped ₹18 / 14 / 11 / 18 / 14 Cr · uncapped ₹4 Cr · unused slots become RTM cards
          </p>
        </div>

        <div className="card pad row between">
          <div>
            <div className="small muted">Purse after retentions</div>
            <div className="price num">{money(RULES.megaPurse - cost)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="small muted">RTM cards</div>
            <div className="price num">{RULES.maxRetentions - picked.length}</div>
          </div>
        </div>

        <section className="card list">
          {options.map(p => {
            const idx = picked.indexOf(p.id);
            return (
              <div key={p.id} className={`list-row${idx >= 0 ? ' current' : ''}`}>
                <PlayerPhoto player={p} size={40} />
                <div className="grow">
                  <div className="name">{p.name}</div>
                  <div className="small muted">
                    {roleLabel(p)} · {p.overseas ? p.country : 'India'} · {p.capped ? 'Capped' : 'Uncapped'} · Rating {p.rating}
                  </div>
                </div>
                <button type="button" className={`btn sm${idx >= 0 ? ' primary' : ''}`} disabled={blocked(p.id)} onClick={() => toggle(p.id)}>
                  {idx >= 0 ? `#${idx + 1} · ${money(plan[idx].cost)}` : 'Retain'}
                </button>
              </div>
            );
          })}
        </section>

        <section className="section">
          <h3>Other teams kept</h3>
          <div className="card list">
            {TEAM_IDS.filter(id => id !== me).map(id => (
              <div key={id} className="list-row">
                <TeamLogo id={id} size={28} />
                <div className="grow small">
                  {state.teams[id].squad.map(e => playerById[e.id].name).join(', ') || <span className="muted">Nobody</span>}
                </div>
                <span className="small muted num">{money(state.teams[id].purse)}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
      <div className="bottom-cta">
        <div style={{ maxWidth: 608, margin: '0 auto' }}>
          <button type="button" className="btn primary big block" onClick={confirm}>
            {picked.length ? `Keep ${picked.length} and start auction` : `Keep nobody and start auction`}
          </button>
          <p className="hint" style={{ textAlign: 'center', marginTop: 6 }}>{teamById[me].name}</p>
        </div>
      </div>
    </>
  );
}
