import { useState } from 'react';
import { TEAM_IDS, teamById } from '../data/teams';
import { RULES } from '../game/rules';
import { playerById, roleLabel } from '../game/players';
import { retainable, retentionError, retentionPlan, squadsPending, type GameState } from '../game/engine';
import { PlayerPhoto, TeamLogo, TeamTag, TopBar, money } from '../ui/common';
import { personName } from '../net/room';

/** Props shared by the retention (mega) and release (mini) screens, for the host and for friends. */
export interface SquadStepProps {
  state: GameState;
  /** Send my choice: retained ids (mega) or released ids (mini). */
  confirm: (ids: string[]) => void;
  /** Host only: stop waiting, bots decide for anyone still choosing. */
  startAnyway?: () => void;
  guest?: boolean;
}

/** After you confirm: who is still choosing, and (host) a way to start without them. */
export function SquadWaiting({ state, startAnyway }: Pick<SquadStepProps, 'state' | 'startAnyway'>) {
  const pending = squadsPending(state);
  const me = state.settings.team;
  return (
    <>
      <TopBar><TeamTag id={me} you /></TopBar>
      <main className="page stack">
        <div className="hero">
          <h1>Squad ready</h1>
          <p className="muted">The auction starts when everyone has picked their squad.</p>
        </div>
        <section className="card list">
          {pending.map(id => (
            <div key={id} className="list-row">
              <TeamLogo id={id} size={28} />
              <div className="grow"><b>{id}</b> <span className="muted">· {personName(state, id)}</span></div>
              <span className="small muted">Still choosing</span>
            </div>
          ))}
        </section>
        {startAnyway && (
          <button type="button" className="btn primary big block" onClick={startAnyway}>
            Start now · bots choose for {pending.length === 1 ? 'them' : `the other ${pending.length}`}
          </button>
        )}
      </main>
    </>
  );
}

export default function Retention({ state, confirm: send, startAnyway, guest }: SquadStepProps) {
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

  const confirm = () => send(picked);
  const others = squadsPending(state).filter(id => id !== me);
  if (state.ready?.includes(me)) return <SquadWaiting state={state} startAnyway={startAnyway} />;

  return (
    <>
      <TopBar back={guest ? undefined : state.settings.names ? '/' : '/bots'}><TeamTag id={me} you /></TopBar>
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
                  {state.teams[id].human && !state.ready?.includes(id)
                    ? <span className="muted">{personName(state, id)} is choosing…</span>
                    : state.teams[id].squad.map(e => playerById[e.id].name).join(', ') || <span className="muted">Nobody</span>}
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
            {others.length
              ? (picked.length ? `Keep ${picked.length} and confirm` : 'Keep nobody and confirm')
              : (picked.length ? `Keep ${picked.length} and start auction` : `Keep nobody and start auction`)}
          </button>
          <p className="hint" style={{ textAlign: 'center', marginTop: 6 }}>{teamById[me].name}</p>
        </div>
      </div>
    </>
  );
}
