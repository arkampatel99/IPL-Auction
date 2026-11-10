import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogoMark, PlayerPhoto, TeamLogo, TopBar } from '../ui/common';
import { PLAYERS, roleLabel } from '../game/players';
import { loadGame } from './useGame';
import { TEAM_IDS, teamById } from '../data/teams';
import { isAdmin } from '../ui/admin';
import { useTeamTheme } from '../ui/theme';

const Icon = ({ d }: { d: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const ICONS = {
  bots: 'M12 3v3M5 9h14v10H5zM9 13h.01M15 13h.01M9 17h6',
  resume: 'M8 5v14l11-7z',
  friends: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  brain: 'M12 5a3 3 0 0 0-6 0 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0zM12 5a3 3 0 0 1 6 0 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0z',
  rules: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
  mic: 'M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v4',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  phone: 'M7 2h10v20H7zM11 18h2',
};

function Choice(props: { to: string; title: string; hint: string; icon: keyof typeof ICONS; primary?: boolean; badge?: string }) {
  return (
    <Link to={props.to} className={`choice${props.primary ? ' primary' : ''}`}>
      <span className="icon"><Icon d={ICONS[props.icon]} /></span>
      <span>
        <span className="title">{props.title}{props.badge && <span className="soon">{props.badge}</span>}</span>
        <br />
        <span className="muted small">{props.hint}</span>
      </span>
      <span className="chev" aria-hidden>›</span>
    </Link>
  );
}

const FEATURES: { icon: keyof typeof ICONS; title: string; text: string }[] = [
  { icon: 'list', title: `${PLAYERS.length} real players`, text: 'IPL · T20Is · 9 leagues' },
  { icon: 'brain', title: 'Smart bots', text: 'Easy · Medium · Hard' },
  { icon: 'rules', title: 'IPL rules', text: 'Retain · RTM · release' },
  { icon: 'mic', title: 'Live auctioneer', text: 'Going once, going twice…' },
  { icon: 'trophy', title: 'Squad ratings', text: 'Rated out of 100' },
  { icon: 'phone', title: 'Auto-saved', text: 'Phone or laptop' },
];



/** The 8 biggest names in the game, with photos first. */
const STARS = [...PLAYERS].sort((a, b) => (b.star + (b.img ? 10 : 0)) - (a.star + (a.img ? 10 : 0))).slice(0, 8);

const LEAD = 'Pick a team, bid against 9 computer teams for real IPL players, and see whose squad rates best.';

/** Title that appears letter by letter. Words stay whole when the line wraps. */
function Letters({ text, start = 0.15, step = 0.035 }: { text: string; start?: number; step?: number }) {
  let i = 0;
  return (
    <span aria-hidden>
      {text.split(' ').map((word, w) => (
        <span key={w} className="word">
          {[...word].map((ch, c) => (
            <span key={c} className="letter" style={{ animationDelay: `${start + (i++) * step}s` }}>{ch}</span>
          ))}
          {w < text.split(' ').length - 1 && <span className="letter space" style={{ animationDelay: `${start + (i++) * step}s` }}>{' '}</span>}
        </span>
      ))}
    </span>
  );
}

/** Line that appears word by word. */
function Words({ text, start = 0, step = 0.045 }: { text: string; start?: number; step?: number }) {
  return (
    <span aria-hidden>
      {text.split(' ').map((word, i) => (
        <span key={i} className="word-in" style={{ animationDelay: `${start + i * step}s` }}>{word}{' '}</span>
      ))}
    </span>
  );
}

/** A number that counts up once when the page opens (instant with reduced motion). */
function CountUp({ to }: { to: number }) {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [v, setV] = useState(reduced ? to : 0);
  useEffect(() => {
    if (reduced) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    const start = setTimeout(() => { raf = requestAnimationFrame(step); }, 300);
    return () => { clearTimeout(start); cancelAnimationFrame(raf); };
  }, [to, reduced]);
  return <>{v}</>;
}

export default function Home() {
  const saved = loadGame();
  const inProgress = saved && saved.phase !== 'done' ? saved : null;
  useTeamTheme(inProgress?.settings.team);
  return (
    <>
      <TopBar />
      <main className="page home">
        <div className="home-main">
        <section className="home-hero">
          <div className="stack" style={{ gap: 14 }}>
            <span className="kicker"><span className="kicker-mark"><LogoMark size={20} /></span> Fan-made IPL auction game</span>
            <h1 aria-label="Run your own IPL auction"><Letters text="Run your own IPL auction" /></h1>
            <p className="lead muted" aria-label={LEAD}><Words text={LEAD} start={0.95} /></p>
            <div className="facts">
              <span><b className="num"><CountUp to={10} /></b> teams</span>
              <span><b className="num"><CountUp to={PLAYERS.length} /></b> real players</span>
              <span><b className="num"><CountUp to={42} /></b> auction sets</span>
              <span><b className="num"><CountUp to={3} /></b> bot levels</span>
            </div>
            <div className="team-row" aria-label="The ten teams">
              {TEAM_IDS.map(id => <TeamLogo key={id} id={id} size={30} />)}
            </div>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <div className="choices">
              {inProgress && (
                <Choice to="/game" icon="resume" primary title="Continue your auction"
                  hint={`${teamById[inProgress.settings.team].name} · ${inProgress.settings.mode === 'mega' ? 'Mega' : 'Mini'} auction`} />
              )}
              <Choice to="/bots" icon="bots" primary={!inProgress} title="Play with Bots" hint="You vs 9 bots" />
              <Choice to="/friends" icon="friends" title="Play with Friends" hint="Create a room or join with a code" />
            </div>
            {isAdmin && (
              <div className="row" style={{ gap: 8 }}>
                <Link to="/songs" className="btn" style={{ flex: 1 }}>Team songs</Link>
                <Link to="/photos" className="btn" style={{ flex: 1 }}>Player photos</Link>
              </div>
            )}
          </div>
        </section>

        <section className="section stars">
          <h3>Biggest names</h3>
          <div className="stars-row">
            {STARS.map(p => (
              <div key={p.id} className="star-card">
                <PlayerPhoto player={p} size={56} />
                <div className="star-name">{p.name}</div>
                <div className="small muted">{roleLabel(p)}</div>
                {p.lastTeam && <TeamLogo id={p.lastTeam} size={20} />}
              </div>
            ))}
          </div>
        </section>

        <section className="section home-features">
          <div className="features">
            {FEATURES.map(f => (
              <article key={f.title} className={`feature card tone-${FEATURES.indexOf(f)}`}>
                <span className="icon"><Icon d={ICONS[f.icon]} /></span>
                <h4>{f.title}</h4>
                <p className="muted small">{f.text}</p>
              </article>
            ))}
          </div>
        </section>
        </div>
        <footer className="footer-note site-footer">
          <span>© 2026 IPL Auction Room. Fan-made, not affiliated with the IPL or BCCI. Stats: Cricsheet. Photos: Wikimedia Commons.</span>
          <span className="row" style={{ gap: 16 }}><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></span>
        </footer>
      </main>
    </>
  );
}
