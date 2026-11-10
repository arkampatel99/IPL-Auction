import { useEffect } from 'react';
import { teamById, type TeamId } from '../data/teams';
import { RULES } from '../game/rules';
import { playerById, type Role } from '../game/players';
import { overseasCount, type GameState } from '../game/engine';
import { squadReport } from '../game/squad';
import { CloseIcon, TeamLogo, money } from '../ui/common';
import { SquadList } from './Auction';

const ROLES: [Role, string][] = [['BAT', 'Batters'], ['WK', 'Keepers'], ['AR', 'All-rounders'], ['BOWL', 'Bowlers']];

/** Any team's purse and squad, opened by tapping a team. */
export default function TeamSheet({ state, team, onClose }: { state: GameState; team: TeamId; onClose: () => void }) {
  const t = state.teams[team];
  const info = teamById[team];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const count = (r: Role) => t.squad.filter(e => playerById[e.id].role === r).length;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={info.name} onClick={onClose}>
      <div className="dialog sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-head" style={{ borderTopColor: info.color }}>
          <TeamLogo id={team} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{info.name}</h2>
            <div className="small muted">{team === state.settings.team ? 'You' : t.human ? (state.settings.names?.[team] ?? 'Friend') : `Bot · ${state.settings.level}`}{t.squad.length >= 11 ? ` · Squad rating ${squadReport(t, { live: true }).overall}` : ''}</div>
          </div>
          <button type="button" className="btn sm ghost" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <div className="sheet-stats">
          <div><div className="k">Purse left</div><div className="v num">{money(t.purse)}</div></div>
          <div><div className="k">Squad</div><div className="v num">{t.squad.length}/{RULES.squadMax}</div></div>
          <div><div className="k">Overseas</div><div className="v num">{overseasCount(t)}/{RULES.overseasMax}</div></div>
          {state.settings.mode === 'mega' && <div><div className="k">RTM cards</div><div className="v num">{t.rtm}</div></div>}
        </div>
        <div className="row small muted" style={{ flexWrap: 'wrap', gap: 12 }}>
          {ROLES.map(([r, n]) => <span key={r}>{n} <b className="num" style={{ color: 'var(--ink)' }}>{count(r)}</b></span>)}
        </div>
        <div className="sheet-body card"><SquadList state={state} team={team} /></div>
      </div>
    </div>
  );
}
