// Theme: dark or light (switch in the top bar), and a theme colour that follows the team you play as
// (or the brand gold, if you choose that in the Menu). Choices are remembered in this browser.
import { useEffect, useState } from 'react';
import { teamById, type TeamId } from '../data/teams';

const BRAND = '#E0A526';
const MODE_KEY = 'ipl-auction-theme';
const COLOR_KEY = 'ipl-auction-theme-color';
export type Mode = 'dark' | 'light';
export type ColorPref = 'team' | 'gold';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } };

let mode: Mode = get(MODE_KEY) === 'light' ? 'light' : 'dark';
let colorPref: ColorPref = get(COLOR_KEY) === 'gold' ? 'gold' : 'team';
let currentTeam: TeamId | null = null;
const listeners = new Set<() => void>();

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const lum = (c: number[]) => {
  const [r, g, b] = c.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Adjust a colour until it stands out on the page background (~3:1 contrast). */
function readable(color: string) {
  let c = hex(color);
  if (mode === 'dark') for (let i = 0; i < 10 && (lum(c) + 0.05) / 0.056 < 3.2; i++) c = c.map(v => v + (255 - v) * 0.18);
  else for (let i = 0; i < 10 && 1.05 / (lum(c) + 0.05) < 3.2; i++) c = c.map(v => v * 0.82);
  return toHex(c);
}

function apply() {
  document.documentElement.dataset.theme = mode;
  const base = colorPref === 'team' && currentTeam ? teamById[currentTeam].color : BRAND;
  const accent = readable(base);
  const ink = lum(hex(accent)) > 0.35 ? '#121110' : '#FFFFFF';
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  root.setProperty('--accent-ink', ink);
  root.setProperty('--focus', accent);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#121110' : '#F7F4EE');
  listeners.forEach(f => f());
}

export function setMode(m: Mode) { mode = m; put(MODE_KEY, m); apply(); }
export function setColorPref(c: ColorPref) { colorPref = c; put(COLOR_KEY, c); apply(); }
export const getMode = () => mode;
export const getColorPref = () => colorPref;

/** Use the given team's colour as the theme while this screen is shown. */
export function useTeamTheme(team: TeamId | null | undefined) {
  useEffect(() => { currentTeam = team ?? null; apply(); }, [team]);
}

/** Re-render when the theme changes. */
export function useThemeState() {
  const [, setV] = useState(0);
  useEffect(() => { const f = () => setV(v => v + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return { mode, colorPref };
}

apply();
