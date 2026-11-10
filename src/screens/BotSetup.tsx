import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TEAMS, teamById, type TeamId } from '../data/teams';
import { RULES, type AuctionMode, type BotLevel } from '../game/rules';
import { createGame } from '../game/engine';
import { Segmented, TeamLogo, TopBar } from '../ui/common';
import { saveGame } from './useGame';
import { primeVoice } from '../ui/voice';
import { useTeamTheme } from '../ui/theme';

const LEVEL_HINT: Record<BotLevel, string> = {
  easy: 'Stars come cheap.',
  medium: 'Fair prices, balanced squads.',
  hard: 'Smart, loyal and tough to beat.',
};
const MODE_HINT: Record<AuctionMode, string> = {
  mega: '₹120 Cr purse · retain up to 6 · RTM cards',
  mini: 'Real 2026 list · real purses · release first',
};

export default function BotSetup() {
  const nav = useNavigate();
  const [team, setTeam] = useState<TeamId>('CSK');
  useTeamTheme(team);
  const [mode, setMode] = useState<AuctionMode>('mega');
  const [level, setLevel] = useState<BotLevel>('medium');
  const [length, setLength] = useState<'quick' | 'full'>('quick');
  const [timer, setTimer] = useState(15);

  const start = () => {
    const seed = Math.floor(Math.random() * 2 ** 31);
    saveGame(createGame({ mode, level, team, timer, length, seed }));
    nav('/game');
  };

  return (
    <>
      <TopBar back="/" />
      <main className="page stack setup">
        <div className="hero">
          <h1>Play with Bots</h1>
          <p className="muted">You vs 9 computer teams.</p>
        </div>

        <section className="section full">
          <h3>Your team</h3>
          <div className="teams-grid">
            {TEAMS.map(t => (
              <button key={t.id} type="button" className="team-tile" aria-pressed={t.id === team} onClick={() => setTeam(t.id)} aria-label={t.name}>
                <span className="bar" style={{ background: t.color }} />
                <span className="tile-logo"><TeamLogo id={t.id} size={40} /></span>
                <span className="code">{t.id}</span>
              </button>
            ))}
          </div>
          <p className="team-name">{teamById[team].name}</p>
        </section>

        <section className="section">
          <h3>Auction type</h3>
          <Segmented label="Auction type" value={mode} onChange={setMode}
            options={[{ value: 'mega', label: 'Mega' }, { value: 'mini', label: 'Mini' }]} />
          <p className="hint">{MODE_HINT[mode]}</p>
        </section>

        <section className="section">
          <h3>Bot level</h3>
          <Segmented label="Bot level" value={level} onChange={setLevel}
            options={[{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} />
          <p className="hint">{LEVEL_HINT[level]}</p>
        </section>

        <section className="section">
          <h3>Length</h3>
          <Segmented label="Length" value={length} onChange={setLength}
            options={mode === 'mega'
              ? [{ value: 'quick', label: `Quick · ${RULES.quickPoolSize} players` }, { value: 'full', label: 'Full · all players' }]
              : [{ value: 'quick', label: `Quick · first ${RULES.quickMiniSize}` }, { value: 'full', label: 'Full list · 350' }]} />
        </section>

        <section className="section">
          <h3>Time per bid</h3>
          <Segmented label="Time per bid" value={timer} onChange={setTimer}
            options={RULES.timerChoices.map(t => ({ value: t, label: `${t} s` }))} />
        </section>

        <div className="summary full" aria-live="polite">
          <TeamLogo id={team} size={28} />
          <span><b>{team}</b> · {mode === 'mega' ? 'Mega' : 'Mini (real 2026 list)'} · {level[0].toUpperCase() + level.slice(1)} bots · {mode === 'mega' ? (length === 'quick' ? `${RULES.quickPoolSize} players` : 'all players') : (length === 'quick' ? `first ${RULES.quickMiniSize} players` : 'all 350 players')} · {timer} s per bid</span>
        </div>
        <button type="button" className="btn primary big block full" onClick={() => { primeVoice(); start(); }}>
          {mode === 'mini' ? 'Start: release players first' : 'Start: retain players first'}
        </button>
      </main>
    </>
  );
}
