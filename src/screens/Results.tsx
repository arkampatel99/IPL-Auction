import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TEAM_IDS, teamById, type TeamId } from '../data/teams';
import { createGame, type GameState } from '../game/engine';
import { roleLabel } from '../game/players';
import { squadReport, type SquadReport } from '../game/squad';
import { PlayerPhoto, TeamLogo, TeamTag, TopBar, money } from '../ui/common';
import { say } from '../ui/voice';
import { playTeamTune } from '../ui/music';
import { saveGame } from './useGame';
import { SquadList } from './Auction';

interface Row { id: TeamId; r: SquadReport; left: number; size: number }

export default function Results({ state }: { state: GameState }) {
  const nav = useNavigate();
  const me = state.settings.team;

  // Rank by overall rating; ties go to the better value for money.
  const ranked: Row[] = useMemo(() => TEAM_IDS.filter(id => !state.teams[id].out || state.teams[id].left)
    .map(id => ({ id, r: squadReport(state.teams[id]), left: state.teams[id].purse, size: state.teams[id].squad.length }))
    .sort((a, b) => b.r.score - a.r.score || b.r.value - a.r.value), [state]);
  const winner = ranked[0];
  const myRank = ranked.findIndex(x => x.id === me) + 1;
  const mine = ranked[myRank - 1];
  const [open, setOpen] = useState<TeamId>(me);
  const shown = ranked.find(x => x.id === open)!;

  useEffect(() => {
    const w = teamById[winner.id];
    playTeamTune(winner.id, 0.45);
    const t = setTimeout(() => say(winner.id === me
      ? `The auction is complete. Congratulations! ${w.name} have the best squad, rated ${winner.r.overall} out of 100.`
      : `The auction is complete. ${w.name} have the best squad, rated ${winner.r.overall}. You finished number ${myRank}.`, 'result'), 5600);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const again = () => {
    saveGame(createGame({ ...state.settings, seed: Math.floor(Math.random() * 2 ** 31) }));
    window.location.reload();
  };
  const w = teamById[winner.id];
  const gap = winner.r.overall - mine.r.overall;

  return (
    <>
      <TopBar back="/" />
      <main className="page stack results">
        {winner.id === me && <Confetti colors={[w.color, w.ink, '#E0A526', '#FFFFFF']} />}
        <section className={`winner${winner.id === me ? ' winner-me' : ''}`} style={{ background: w.color, color: w.ink }}>
          <TeamLogo id={winner.id} size={96} />
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <span className="stamp" style={{ borderColor: w.ink }}>{winner.id === me ? 'You won' : 'Winner'}</span>
            <h1 className="winner-name">{w.name}{winner.id === me ? ' (you)' : ''}</h1>
            <div className="winner-score num">{winner.r.overall}<span>/100</span> <b className="grade">{winner.r.grade}</b></div>
            <div className="chant">{w.chant}</div>
          </div>
        </section>

        {winner.id !== me && (
          <div className="notice">
            {`You finished `}<b>{`#${myRank} of 10`}</b>{` with `}<b>{`${mine.r.overall}/100`}</b>{`, ${gap} ${gap === 1 ? 'point' : 'points'} behind ${w.city}.`}
          </div>
        )}

        <div className="results-grid">
          <Report row={shown} rank={ranked.indexOf(shown) + 1} me={me} state={state} />
          <section className="card">
            <div className="pad" style={{ paddingBottom: 8 }}><h3>Leaderboard</h3></div>
            <table className="table">
              <thead>
                <tr><th>#</th><th>Team</th><th className="r">Rating</th><th className="r">Quality</th><th className="r">Value</th><th className="r hide-sm">Bat</th><th className="r hide-sm">Bowl</th><th className="r">Spent</th></tr>
              </thead>
              <tbody>
                {ranked.map((x, i) => (
                  <tr key={x.id} className={`${x.id === me ? 'me' : ''}${x.id === open ? ' open' : ''}`} onClick={() => setOpen(x.id)} style={{ cursor: 'pointer' }}>
                    <td className="num">{i === 0 ? '1st' : i + 1}</td>
                    <td><TeamTag id={x.id} you={x.id === me} /></td>
                    <td className="r num"><b>{x.r.overall}</b> <span className="muted small">{x.r.grade}</span></td>
                    <td className="r num">{x.r.quality}</td>
                    <td className="r num">{x.r.value}</td>
                    <td className="r num hide-sm">{x.r.batting}</td>
                    <td className="r num hide-sm">{x.r.bowling}</td>
                    <td className="r num">{money(x.r.spent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted pad">Tap a team to see its report. Rating = 60% squad quality + 40% value for money. Quality is your best XI's player ratings (best players count a little more), plus a little for big names, minus gaps like no keeper or a short squad. Value compares what your players are worth with what you paid: paying fair value scores 70, buying them 40% cheaper scores 90. Smart buys win.</p>
          </section>
        </div>

        <div className="row">
          <button className="btn primary big" style={{ flex: 1 }} onClick={again}>Play again</button>
          <button className="btn big" onClick={() => { saveGame(null); nav('/'); }}>Home</button>
        </div>
      </main>
    </>
  );
}

/** One burst of confetti in the winner's colours. */
function Confetti({ colors }: { colors: string[] }) {
  const pieces = useMemo(() => Array.from({ length: 120 }, () => ({
    left: Math.random() * 100, delay: Math.random() * 0.8, dur: 2.6 + Math.random() * 2,
    drift: (Math.random() - 0.5) * 260, spin: (Math.random() - 0.5) * 1080, w: 6 + Math.random() * 8, h: 10 + Math.random() * 10,
    c: colors[Math.floor(Math.random() * colors.length)],
  })), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="confetti results-confetti" aria-hidden>
      {pieces.map((p, i) => (
        <i key={i} style={{ left: `${p.left}%`, width: p.w, height: p.h, background: p.c, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`,
          ['--drift' as string]: `${p.drift}px`, ['--spin' as string]: `${p.spin}deg` }} />
      ))}
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <span className="bar-track"><span className={`bar-fill${value >= 80 ? ' hi' : value < 60 ? ' lo' : ''}`} style={{ width: `${value}%` }} /></span>
      <b className="num bar-val">{value}</b>
    </div>
  );
}

function Report({ row, rank, me, state }: { row: Row; rank: number; me: TeamId; state: GameState }) {
  const { r, id } = row;
  const t = teamById[id];
  const [squadOpen, setSquadOpen] = useState(false);
  return (
    <section className="card report" style={{ borderTopColor: t.color }}>
      <div className="pad stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 12 }}>
          <TeamLogo id={id} size={48} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{t.name}{id === me ? ' · You' : ''}</h2>
            <div className="small muted">#{rank} of 10 · {row.size} players · spent {money(r.spent)} · {money(row.left)} left</div>
          </div>
          <div className="report-score num">{r.overall}<span>/100</span><div className="grade">{r.grade}</div></div>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <Bar label="Squad quality" value={r.quality} />
          <Bar label="Value for money" value={r.value} />
          <Bar label="Batting" value={r.batting} />
          <Bar label="Bowling" value={r.bowling} />
          <Bar label="Balance" value={r.balance} />
          <Bar label="Bench" value={r.depth} />
          <Bar label="Star power" value={r.star} />
        </div>

        {(r.strengths.length > 0 || r.weaknesses.length > 0) && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {r.strengths.map(s => <span key={s} className="pill good">{s}</span>)}
            {r.weaknesses.map(s => <span key={s} className="pill bad">{s}</span>)}
          </div>
        )}

        <div className="buys">
          {r.topBuy && <div><span className="small muted">Biggest buy</span><br /><b>{r.topBuy.player.name}</b> <span className="num">{money(r.topBuy.price)}</span></div>}
          {r.bestBuy && <div><span className="small muted">Best value</span><br /><b>{r.bestBuy.player.name}</b> <span className="num">{money(r.bestBuy.price)}</span></div>}
        </div>

        <div>
          <h3 style={{ marginBottom: 6 }}>Best XI</h3>
          <ol className="xi">
            {r.xi.map(p => (
              <li key={p.id}>
                <PlayerPhoto player={p} size={28} />
                <span className="grow"><b>{p.name}</b> <span className="small muted">{roleLabel(p)}{p.overseas ? ' · OS' : ''}</span></span>
                {p.star >= 60 && <span className={`tag star-tag${p.star >= 80 ? ' legend' : ''}`}>{p.star >= 80 ? 'Legend' : 'Star'}</span>}
                <span className="small num muted">{p.rating}</span>
              </li>
            ))}
          </ol>
        </div>

        <button type="button" className="btn block" onClick={() => setSquadOpen(o => !o)}>{squadOpen ? 'Hide full squad' : `Show full squad (${row.size})`}</button>
      </div>
      {squadOpen && <SquadList state={state} team={id} />}
    </section>
  );
}
