import { useEffect, useState } from 'react';
import { hostRoom } from '../net/room';

/** The app script this page loaded, e.g. /assets/index-AbC123.js (absent in dev). */
const current = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') ?? null;

/**
 * A page left open keeps running the version it loaded. Check for a newer deploy every few minutes
 * (and when the tab comes back) and offer a one-tap update.
 */
export default function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const mine = current();
    if (!mine) return;
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState !== 'visible') return;
      try {
        const html = await (await fetch(`/?check=${Date.now()}`, { cache: 'no-store' })).text();
        const live = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
        if (live && live !== mine) setReady(true);
      } catch { /* offline: try later */ }
    };
    const timer = window.setInterval(check, 3 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    void check();
    return () => { stop = true; clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!ready) return null;
  const hosting = Boolean(hostRoom());
  return (
    <div className="update-bar" role="status">
      <span>{hosting ? 'New version ready. Updating ends your room, so update after this auction.' : 'A new version of the game is ready.'}</span>
      <button type="button" className="btn sm primary" onClick={() => window.location.reload()}>Update</button>
    </div>
  );
}
