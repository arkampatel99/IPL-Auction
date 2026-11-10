import { teamById, type TeamId } from '../data/teams';
import type { GameState } from '../game/engine';
import { TeamLogo, money } from '../ui/common';
import { personName } from '../net/room';

export type CallKind = 'intro' | 'bid' | 'call' | 'result';
export interface Call {
  text: string;
  kind: CallKind;
  at: number;             // when it was said (re-triggers animations)
  team?: TeamId;          // bid / sold
  amount?: number;
  sold?: boolean;         // result: sold or unsold
}

type Gavel = 'idle' | 'tap' | 'slam';

/** What the bubble shows right now, and what the gavel does. */
function scene(state: GameState, call: Call | null) {
  const lot = state.lot;
  const left = lot && !state.paused ? lot.endsAt - Date.now() : Infinity;
  if (!lot && call?.kind === 'result' && call.sold !== undefined) return { mode: 'result' as const, gavel: (call.sold ? 'slam' : 'tap') as Gavel, key: call.at };
  if (lot?.leader && left <= 3000) {
    const twice = left <= 1500;
    return { mode: twice ? 'twice' as const : 'once' as const, gavel: 'tap' as Gavel, key: `${lot.playerId}:${lot.bid}:${twice}` };
  }
  if (call?.kind === 'bid') return { mode: 'bid' as const, gavel: 'tap' as Gavel, key: call.at };
  return { mode: 'talk' as const, gavel: 'idle' as Gavel, key: call?.at ?? 0 };
}

export default function AuctioneerStage({ state, call, compact }: { state: GameState; call: Call | null; compact?: boolean }) {
  const sc = scene(state, call);
  const lot = state.lot;
  const talking = call && Date.now() - call.at < 1800;

  let bubble: React.ReactNode;
  if (sc.mode === 'result' && call) {
    bubble = call.sold && call.team
      ? <div className="bubble-sold"><span className="bubble-big">SOLD!</span><TeamCall team={call.team} amount={call.amount!} who={personName(state, call.team)} /></div>
      : <span className="bubble-big">Unsold</span>;
  } else if (sc.mode === 'once' || sc.mode === 'twice') {
    bubble = (
      <div className="bubble-going">
        <span className="bubble-big">{sc.mode === 'once' ? 'Going once…' : 'Going twice…'}</span>
        {lot?.leader && <TeamCall team={lot.leader} amount={lot.bid!} who={personName(state, lot.leader)} small />}
      </div>
    );
  } else if (sc.mode === 'bid' && call?.team) {
    bubble = <TeamCall team={call.team} amount={call.amount!} who={personName(state, call.team)} />;
  } else {
    bubble = <span className="bubble-text">{call?.text ?? 'Welcome to the auction.'}</span>;
  }

  // Whose bid is it? The bubble fills with that team's colour.
  const bubbleTeam = sc.mode === 'result' && call?.sold && call.team ? call.team
    : sc.mode === 'bid' && call?.team ? call.team
    : (sc.mode === 'once' || sc.mode === 'twice') && lot?.leader ? lot.leader : null;
  const tc = bubbleTeam ? teamById[bubbleTeam] : null;

  return (
    <div className={`stage${compact ? ' compact' : ''}${sc.gavel === 'slam' ? ' slammed' : ''}`} key={compact ? undefined : `stage-${sc.mode === 'result' ? sc.key : 'x'}`}>
      <Auctioneer gavel={sc.gavel} gavelKey={String(sc.key)} talking={Boolean(talking)} size={compact ? 52 : 120} />
      <div className={`bubble mode-${sc.mode}${tc ? ' team-filled' : ''}`} key={String(sc.key)}
        style={tc ? { ['--bubble-bg' as string]: tc.color, ['--bubble-ink' as string]: tc.ink } : undefined}>
        {!compact && <span className="bubble-label">Auctioneer</span>}
        {bubble}
      </div>
    </div>
  );
}

function TeamCall({ team, amount, small, who }: { team: TeamId; amount: number; small?: boolean; who?: string | null }) {
  return (
    <span className={`team-call${small ? ' small' : ''}`}>
      <TeamLogo id={team} size={small ? 22 : 30} />
      <span className="team-call-city">{who ? `${who} · ${team}` : teamById[team].city}</span>
      <span className="team-call-amount num">{money(amount)}</span>
    </span>
  );
}

/** The auctioneer: flat illustration, gavel in the right hand. */
function Auctioneer({ gavel, gavelKey, talking, size }: { gavel: Gavel; gavelKey: string; talking: boolean; size: number }) {
  return (
    <svg className="auctioneer" width={size} height={size * 1.15} viewBox="0 0 120 138" aria-hidden>
      {/* body */}
      <path d="M30 78 Q60 66 90 78 L96 106 L24 106 Z" fill="#1F2A44" />
      <path d="M52 72 L60 92 L68 72 Z" fill="#F4F4F2" />
      <path d="M58 76 L62 76 L63 92 L60 96 L57 92 Z" fill="#B4351F" />
      {/* head */}
      <rect x="54" y="58" width="12" height="10" fill="#B97A50" />
      <circle cx="60" cy="44" r="18" fill="#C98B5E" />
      <circle cx="42" cy="46" r="3.5" fill="#C98B5E" />
      <circle cx="78" cy="46" r="3.5" fill="#C98B5E" />
      <path d="M42 42 Q42 24 60 24 Q78 24 78 42 Q72 32 60 33 Q48 32 42 42 Z" fill="#2A1E17" />
      <circle cx="53" cy="44" r="2" fill="#15171A" />
      <circle cx="67" cy="44" r="2" fill="#15171A" />
      <path d="M49 39 L56 38 M64 38 L71 39" stroke="#2A1E17" strokeWidth="2" strokeLinecap="round" />
      <path d="M53 51 Q60 49 67 51" stroke="#2A1E17" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse className={`mouth${talking ? ' talking' : ''}`} cx="60" cy="55.5" rx="4" ry="2" fill="#5A2A22" />
      {/* left arm on the podium */}
      <path d="M32 82 Q22 96 34 104" stroke="#1F2A44" strokeWidth="10" fill="none" strokeLinecap="round" />
      {/* right arm + gavel */}
      <g className={`gavel-arm ${gavel}`} key={gavelKey}>
        <path d="M86 82 Q100 76 102 62" stroke="#1F2A44" strokeWidth="10" fill="none" strokeLinecap="round" />
        <circle cx="102" cy="60" r="5.5" fill="#C98B5E" />
        <rect x="100" y="40" width="4" height="22" rx="2" fill="#7A4A26" transform="rotate(-20 102 60)" />
        <rect x="92" y="34" width="22" height="10" rx="3" fill="#5C3519" transform="rotate(-20 102 60)" />
      </g>
      {/* podium + sound block */}
      <rect x="8" y="104" width="104" height="34" rx="4" fill="#2B2F36" />
      <rect x="8" y="104" width="104" height="6" rx="3" fill="#3A3F48" />
      <rect x="92" y="98" width="18" height="7" rx="2" fill="#5C3519" />
      <g className="impact">
        <path d="M90 92 L86 86 M101 90 L101 83 M112 92 L116 86" stroke="#F9CD05" strokeWidth="2.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
