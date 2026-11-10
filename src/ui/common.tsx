import { useEffect, useState, type ReactNode } from 'react';
import { onPhotosChange, photoSlug, savedPhoto } from './photoStore';
import { setMode, useThemeState } from './theme';
import { Link, useNavigate } from 'react-router-dom';
import { teamById, logoUrl, type TeamId } from '../data/teams';
import type { Player } from '../game/players';

/** ₹ in lakhs → "₹50 L" / "₹2.4 Cr". */
export function money(lakhs: number) {
  if (lakhs >= 100) return `₹${+(lakhs / 100).toFixed(2)} Cr`;
  return `₹${lakhs} L`;
}

export function TeamBadge({ id, label }: { id: TeamId; label?: string }) {
  const t = teamById[id];
  return <span className="badge" style={{ background: t.color, color: t.ink }}>{label ?? id}</span>;
}

/** Team logo; falls back to a solid colour square with the team code. */
export function TeamLogo({ id, size = 32 }: { id: TeamId; size?: number }) {
  const [broken, setBroken] = useState(false);
  const t = teamById[id];
  if (broken) {
    return (
      <span className="logo" style={{ width: size, height: size, background: t.color, color: t.ink, fontSize: size * 0.3 }} title={t.name}>
        {id}
      </span>
    );
  }
  return (
    <span className="logo" style={{ width: size, height: size }} title={t.name}>
      <img src={logoUrl(id)} alt={t.name} width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    </span>
  );
}

/** Logo + code chip used in lists. */
export function TeamTag({ id, you }: { id: TeamId; you?: boolean }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <TeamLogo id={id} size={24} />
      <TeamBadge id={id} label={you ? `${id} · You` : id} />
    </span>
  );
}

/** Re-render when you add or remove a photo. */
function usePhotosVersion() {
  const [, setV] = useState(0);
  useEffect(() => onPhotosChange(() => setV(v => v + 1)), []);
}

export function PlayerPhoto({ player, size = 48, team: teamId }: { player: Player; size?: number; team?: TeamId | null }) {
  usePhotosVersion();
  // Photo sources in order: one you added in the app, the free photo, then public/players/<name>.jpg.
  const sources = [savedPhoto(player.id), player.img, `/players/${photoSlug(player.name)}.jpg`].filter(Boolean) as string[];
  const [failed, setFailed] = useState(0);
  useEffect(() => setFailed(0), [sources[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const src = sources[failed];
  const tid = teamId === undefined ? player.lastTeam : teamId;
  const team = tid ? teamById[tid] : null;
  const style = { width: size, height: size * 1.15, fontSize: size * 0.34 };
  if (!src) {
    // No free photo: a silhouette in the player's last team colours, with initials.
    return (
      <div className="photo silhouette" style={{ ...style, background: team?.color ?? 'var(--surface-2)', color: team?.ink ?? 'var(--muted)' }} title={player.name}>
        <svg viewBox="0 0 40 46" width="100%" height="100%" aria-hidden>
          <circle cx="20" cy="17" r="8.5" fill="currentColor" opacity="0.35" />
          <path d="M4 46 Q4 30 20 29 Q36 30 36 46 Z" fill="currentColor" opacity="0.35" />
        </svg>
      </div>
    );
  }
  return (
    <div className="photo" style={style} title={src === player.img && player.imgCredit ? `Photo: ${player.imgCredit}` : player.name}>
      <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(f => f + 1)}
        onLoad={e => e.currentTarget.classList.add('loaded')} />
    </div>
  );
}

export function Segmented<T extends string | number>(props: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map(o => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Plain line icon for close buttons. */
export function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** App mark: an auction gavel striking its sound block. Same drawing as the favicon. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo-mark">
      <rect width="64" height="64" rx="15" fill="#0B0B0B" />
      <rect x="9" y="48" width="30" height="8" rx="4" fill="#BDBDBD" />
      <g transform="rotate(-38 34 26)">
        <rect x="31" y="27" width="6" height="28" rx="3" fill="#FFFFFF" />
        <rect x="18" y="13" width="32" height="15" rx="4.5" fill="#FFFFFF" />
        <rect x="23" y="13" width="3" height="15" fill="#0B0B0B" />
        <rect x="42" y="13" width="3" height="15" fill="#0B0B0B" />
      </g>
    </svg>
  );
}

export function Brand() {
  return (
    <Link to="/" className="brand">
      <LogoMark size={28} />
      <span className="brand-text"><span className="brand-ipl">IPL</span>Auction Room</span>
    </Link>
  );
}

/** Sun / moon button that switches between the dark and light theme. */
export function ThemeToggle() {
  const { mode } = useThemeState();
  const next = mode === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="btn sm theme-toggle" onClick={() => setMode(next)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {mode === 'dark'
          ? <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
          : <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
      </svg>
    </button>
  );
}

/** Top bar. `back`: a path to go to, or true for the previous screen. */
export function TopBar({ children, back }: { children?: ReactNode; back?: string | true }) {
  const nav = useNavigate();
  const goBack = () => {
    if (back === true) { if (window.history.length > 1) nav(-1); else nav('/'); } else if (back) nav(back);
  };
  return (
    <header className="topbar">
      <div className="row" style={{ gap: 10 }}>
        {back && (
          <button type="button" className="btn sm back-btn" onClick={goBack} aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
            <span className="btn-label">Back</span>
          </button>
        )}
        <Brand />
      </div>
      <div className="row">{children}<ThemeToggle /></div>
    </header>
  );
}
