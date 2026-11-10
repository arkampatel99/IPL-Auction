// Auctioneer voice using the browser's built-in speech (Web Speech API). Free, no server.
// Prefers an Indian English voice when the device has one.

import { primeAudio } from './music';

const KEY = 'ipl-auction-voice';
const synth: SpeechSynthesis | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

let enabled = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();
let voice: SpeechSynthesisVoice | null = null;
let lastKind: Kind | null = null;
let lastEnd = 0;
let quietUntil = 0; // auctioneer stays silent while a team song plays

type Kind = 'intro' | 'bid' | 'call' | 'result';

function pickVoice() {
  const all = synth?.getVoices() ?? [];
  return all.find(v => v.lang === 'en-IN') ?? all.find(v => v.lang === 'en-GB') ?? all.find(v => v.lang.startsWith('en')) ?? null;
}
synth?.addEventListener?.('voiceschanged', () => { voice = pickVoice(); });

export const voiceSupported = () => Boolean(synth);
export const voiceOn = () => enabled && Boolean(synth);

export function setVoiceOn(on: boolean) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage off */ }
  if (on) primeVoice(); else synth?.cancel();
}

/** Mobile browsers only allow speech after a tap: call this from a click handler. */
export function primeVoice() {
  if (enabled) primeAudio();
  if (!synth || !enabled) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  synth.speak(u);
}

/** Speak a line. A new bid cuts off the previous bid call; a result cuts off everything. */
/** Silence the auctioneer for `ms` (used while a team song plays). */
export function hushFor(ms: number) {
  quietUntil = Date.now() + ms;
  synth?.cancel();
}

export function say(text: string, kind: Kind) {
  if (!synth || !enabled || Date.now() < quietUntil) return;
  if (kind === 'result' || ((kind === 'bid' || kind === 'call') && (lastKind === 'bid' || lastKind === 'call'))) synth.cancel();
  voice ??= pickVoice();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? 'en-IN';
  u.rate = kind === 'bid' ? 1.15 : 1.02;
  lastKind = kind;
  lastEnd = Date.now() + 60_000; // until onend fires
  u.onend = u.onerror = () => { lastEnd = Date.now(); };
  synth.speak(u);
}

/** Milliseconds since the auctioneer last stopped talking (0 while talking). */
export function quietFor() {
  if (synth?.speaking) return 0;
  return Math.max(0, Date.now() - Math.min(lastEnd, Date.now()));
}

/** 875 → "8 crore 75 lakh", 50 → "50 lakh". */
export function spokenMoney(lakhs: number) {
  if (lakhs < 100) return `${lakhs} lakh`;
  const cr = Math.floor(lakhs / 100), rest = lakhs % 100;
  return rest ? `${cr} crore ${rest} lakh` : `${cr} crore`;
}
