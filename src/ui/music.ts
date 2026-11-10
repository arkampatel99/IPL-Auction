// Each team's song, played for ~4 s when it buys a player.
// If public/sounds/<TEAM>.mp3 exists (audio you own or licensed), that plays.
// Otherwise the team's own original song below is generated with the Web Audio API.

import type { TeamId } from '../data/teams';
import { savedSong } from './songStore';
import { teamById } from '../data/teams';
import { hushFor } from './voice';

type Beat = 'rock' | 'march' | 'dhol';
interface Song {
  bpm: number;
  root: number;                 // MIDI note of the key
  wave: OscillatorType;         // lead sound
  lead: (number | null)[];      // 16 eighth notes, semitones from root (null = rest)
  chords: [number, 'maj' | 'min'][]; // 4 bars, one chord each
  beat: Beat;
}
// Original 4-bar songs, one per team: each has its own key, tempo, melody, chords and groove.
const SONGS: Record<TeamId, Song> = {
  CSK: { bpm: 148, root: 62, wave: 'sawtooth', beat: 'dhol', lead: [0, null, 4, 7, 9, 7, 4, null, 5, 4, 2, 4, 7, null, 12, null], chords: [[0, 'maj'], [5, 'maj'], [7, 'maj'], [0, 'maj']] },
  MI: { bpm: 132, root: 60, wave: 'square', beat: 'rock', lead: [7, 7, 12, 11, 7, null, 4, 5, 7, 7, 14, 12, 11, null, 12, null], chords: [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'maj']] },
  RCB: { bpm: 160, root: 57, wave: 'sawtooth', beat: 'rock', lead: [0, 3, 7, 3, 10, 7, 12, null, 0, 3, 7, 10, 15, 12, 10, null], chords: [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']] },
  KKR: { bpm: 126, root: 58, wave: 'square', beat: 'march', lead: [0, null, 0, 3, 7, null, 8, 7, 3, null, 3, 5, 7, 8, 12, null], chords: [[0, 'min'], [5, 'min'], [8, 'maj'], [7, 'maj']] },
  SRH: { bpm: 156, root: 64, wave: 'sawtooth', beat: 'dhol', lead: [12, 10, 7, 10, 12, null, 7, 5, 7, 5, 3, 5, 7, null, 0, null], chords: [[0, 'min'], [10, 'maj'], [8, 'maj'], [7, 'maj']] },
  RR: { bpm: 140, root: 63, wave: 'triangle', beat: 'dhol', lead: [0, 4, 7, 9, 7, 4, 2, null, 4, 7, 9, 12, 9, 7, 12, null], chords: [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']] },
  DC: { bpm: 144, root: 59, wave: 'square', beat: 'march', lead: [0, 7, null, 7, 9, 7, 5, 4, 2, null, 4, 5, 7, 9, 11, 12], chords: [[0, 'maj'], [5, 'maj'], [2, 'min'], [7, 'maj']] },
  PBKS: { bpm: 152, root: 61, wave: 'sawtooth', beat: 'dhol', lead: [0, 0, 2, 4, 7, null, 4, 2, 0, 0, 2, 4, 9, 7, 12, null], chords: [[0, 'maj'], [7, 'maj'], [5, 'maj'], [7, 'maj']] },
  LSG: { bpm: 134, root: 60, wave: 'triangle', beat: 'rock', lead: [5, null, 9, 12, 14, 12, 9, null, 7, null, 12, 9, 7, 5, 4, 5], chords: [[5, 'maj'], [0, 'maj'], [2, 'min'], [7, 'maj']] },
  GT: { bpm: 124, root: 55, wave: 'square', beat: 'march', lead: [0, 3, 7, null, 12, 10, 7, null, 8, 7, 3, null, 2, 3, 7, null], chords: [[0, 'min'], [3, 'maj'], [10, 'maj'], [7, 'maj']] },
};
const CHORD = { maj: [0, 4, 7], min: [0, 3, 7] };
// Drum hits per 16 eighths: k = kick, s = snare, t = low tom (dhol), h = hi-hat.
const BEATS: Record<Beat, string[]> = {
  rock: ['kh', 'h', 'sh', 'h', 'kh', 'kh', 'sh', 'h', 'kh', 'h', 'sh', 'h', 'kh', 'kh', 'sh', 's'],
  march: ['ks', 's', 'sh', 's', 'ks', 'h', 'sh', 's', 'ks', 's', 'sh', 's', 'ks', 's', 's', 's'],
  dhol: ['kt', 'h', 't', 'th', 'kt', 'h', 'th', 't', 'kt', 'h', 't', 'th', 'kt', 't', 'th', 't'],
};

let ctx: AudioContext | null = null;
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

function audio() {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Unlock audio on a tap (mobile browsers need this once). */
export function primeAudio() { audio(); }

function note(c: AudioContext, out: AudioNode, midi: number, at: number, len: number, wave: OscillatorType, vol: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, at + len);
  g.connect(out);
  for (const detune of [-6, 6]) {
    const o = c.createOscillator();
    o.type = wave;
    o.frequency.value = hz(midi);
    o.detune.value = detune;
    o.connect(g);
    o.start(at);
    o.stop(at + len + 0.05);
  }
}

function noise(c: AudioContext, len: number) {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const n = c.createBufferSource();
  n.buffer = buf;
  return n;
}

function hit(c: AudioContext, out: AudioNode, at: number, kind: string) {
  if (kind === 'k' || kind === 't') {
    const o = c.createOscillator(), g = c.createGain();
    const [hi, lo, len, vol] = kind === 'k' ? [140, 45, 0.2, 0.9] : [220, 110, 0.18, 0.6];
    o.frequency.setValueAtTime(hi, at);
    o.frequency.exponentialRampToValueAtTime(lo, at + len * 0.7);
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + len);
    o.connect(g).connect(out);
    o.start(at); o.stop(at + len + 0.02);
    return;
  }
  const n = noise(c, kind === 's' ? 0.14 : 0.05);
  const f = c.createBiquadFilter(), g = c.createGain();
  f.type = kind === 's' ? 'bandpass' : 'highpass';
  f.frequency.value = kind === 's' ? 1800 : 6000;
  g.gain.value = kind === 's' ? 0.45 : 0.18;
  n.connect(f).connect(g).connect(out);
  n.start(at);
}

function song(team: TeamId, volume: number) {
  const c = audio();
  if (!c) return;
  const m = SONGS[team];
  const step = 60 / m.bpm / 2; // eighth note
  const t0 = c.currentTime + 0.05;
  const master = c.createGain();
  master.gain.value = volume;
  master.connect(c.destination);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2800;
  lp.connect(master);

  m.chords.forEach(([deg, q], bar) => {
    const at = t0 + bar * 4 * step;
    for (const n of CHORD[q]) note(c, lp, m.root + deg + n, at, step * 4, 'triangle', 0.05); // pad
    for (let i = 0; i < 4; i += 2) note(c, lp, m.root - 12 + deg, at + i * step, step * 1.8, 'triangle', 0.2); // bass
  });
  m.lead.forEach((n, i) => { if (n !== null) note(c, lp, m.root + 12 + n, t0 + i * step, step * 1.5, m.wave, 0.09); });
  BEATS[m.beat].forEach((hits, i) => { for (const h of hits) hit(c, master, t0 + i * step, h); });

  // Final chord on the home key, held.
  const end = t0 + 16 * step;
  for (const n of CHORD[m.chords[0][1]]) note(c, lp, m.root + 12 + n, end, 1.2, m.wave, 0.07);
  note(c, lp, m.root - 12, end, 1.2, 'triangle', 0.22);
  hit(c, master, end, 'k');
  hit(c, master, end, 's');
}

let current: HTMLAudioElement | null = null;

/** Stop whatever team song is playing (fades out over ~0.6 s). */
export function stopSong() {
  const a = current;
  current = null;
  if (!a) return;
  const v0 = a.volume;
  let i = 0;
  const t = setInterval(() => {
    i++;
    a.volume = Math.max(0, v0 * (1 - i / 6));
    if (i >= 6) { clearInterval(t); a.pause(); }
  }, 100);
}

/** Play a clip of an audio URL from `start` for `length` seconds, fading out at the end. */
function clip(url: string, start: number, length: number, volume: number, onFail: () => void) {
  stopSong();
  const a = new Audio(url);
  a.volume = volume;
  current = a;
  a.addEventListener('error', onFail, { once: true });
  a.addEventListener('loadedmetadata', () => { a.currentTime = Math.min(start, Math.max(0, a.duration - 1)); }, { once: true });
  a.play()
    .then(() => setTimeout(() => { if (current === a) stopSong(); }, Math.max(1, length) * 1000))
    .catch(onFail);
}

const TIMES_KEY = 'ipl-auction-song-times';
type Times = Partial<Record<TeamId, { start: number; length: number }>>;

/** Where each team's clip starts and how long it plays (Team songs screen can change it). */
export function songTimes(team: TeamId) {
  let saved: Times = {};
  try { saved = JSON.parse(localStorage.getItem(TIMES_KEY) ?? '{}'); } catch { /* ignore */ }
  return { start: saved[team]?.start ?? teamById[team].song.start, length: saved[team]?.length ?? 5 };
}
export function setSongTimes(team: TeamId, start: number, length: number) {
  try {
    const saved: Times = JSON.parse(localStorage.getItem(TIMES_KEY) ?? '{}');
    saved[team] = { start, length };
    localStorage.setItem(TIMES_KEY, JSON.stringify(saved));
  } catch { /* storage off */ }
}
export const teamSongUrl = (team: TeamId) => `/sounds/${team}.mp3`;

/**
 * Play the team's song when it buys a player:
 * 1. a file you picked on the Team songs screen (saved in this browser),
 * 2. else the team's file in public/sounds/, from its start second for 5 s,
 * 3. else (file missing) the team's generated tune.
 */
export function playTeamTune(team: TeamId, volume = 0.5) {
  // The song is the moment: the auctioneer stays quiet until it ends.
  const length = savedSong(team)?.song.length ?? songTimes(team).length;
  hushFor(length * 1000 + 400);
  let fellBack = false;
  const generated = () => { if (!fellBack) { fellBack = true; song(team, volume); } };
  const mine = savedSong(team);
  try {
    if (mine) { clip(mine.url, mine.song.start, mine.song.length, Math.min(1, volume * 1.6), generated); return; }
    const t = songTimes(team);
    clip(teamSongUrl(team), t.start, t.length, Math.min(1, volume * 1.6), generated);
  } catch {
    generated();
  }
}

/** Preview on the Team songs screen. */
export function previewSong(url: string, start: number, length: number) {
  clip(url, start, length, 0.8, () => {});
}

/** Play the generated tune (for preview). */
export function playGenerated(team: TeamId) { stopSong(); song(team, 0.5); }

/** Gavel on wood: a short, low knock. */
export function knock(volume = 0.8) {
  const c = audio();
  if (!c) return;
  const at = c.currentTime + 0.01;
  const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o.type = 'triangle';
  o.frequency.setValueAtTime(320, at);
  o.frequency.exponentialRampToValueAtTime(90, at + 0.12);
  f.type = 'lowpass'; f.frequency.value = 1200;
  g.gain.setValueAtTime(volume, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
  o.connect(f).connect(g).connect(c.destination);
  o.start(at); o.stop(at + 0.2);
  hit(c, c.destination, at, 't');
}
