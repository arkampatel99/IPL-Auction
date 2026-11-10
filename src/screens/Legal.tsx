import { Link } from 'react-router-dom';
import { TopBar } from '../ui/common';

const UPDATED = '10 November 2026';

export function Privacy() {
  return (
    <>
      <TopBar back="/" />
      <main className="page stack legal">
        <div className="hero">
          <h1>Privacy policy</h1>
          <p className="muted small">Last updated {UPDATED}</p>
        </div>

        <section className="section">
          <h2>What this game stores</h2>
          <p>Everything stays in your own browser, on your device. Nothing is sent to us.</p>
          <ul>
            <li>Your saved auction, so you can continue later.</li>
            <li>Settings such as sound on or off, and song start times.</li>
            <li>Team songs and player photos you add yourself.</li>
          </ul>
          <p>Clearing your browser data for this site deletes all of it.</p>
        </section>

        <section className="section">
          <h2>What we don't do</h2>
          <ul>
            <li>No accounts, sign-ups or passwords.</li>
            <li>No analytics, tracking or advertising.</li>
            <li>No cookies set by the game.</li>
          </ul>
        </section>

        <section className="section">
          <h2>Other services the page loads from</h2>
          <ul>
            <li>Google Fonts, for the Inter typeface.</li>
            <li>scores.iplt20.com, for team logos.</li>
            <li>Wikimedia Commons, for player photos.</li>
            <li>The hosting provider, which may keep standard server logs such as IP address and time of request.</li>
          </ul>
          <p>These services have their own privacy policies.</p>
        </section>

        <Link to="/terms">Terms and conditions</Link>
      </main>
    </>
  );
}

export function Terms() {
  return (
    <>
      <TopBar back="/" />
      <main className="page stack legal">
        <div className="hero">
          <h1>Terms and conditions</h1>
          <p className="muted small">Last updated {UPDATED}</p>
        </div>

        <section className="section">
          <h2>About this game</h2>
          <p>IPL Auction Room is a free, fan-made game for personal, non-commercial use. It is not affiliated with, endorsed by or connected to the Indian Premier League, the BCCI or any franchise.</p>
        </section>

        <section className="section">
          <h2>Names, logos and data</h2>
          <ul>
            <li>Team names, logos and the IPL name belong to their owners and are shown only to identify the teams.</li>
            <li>Player statistics come from Cricsheet (cricsheet.org). The auction list is based on the official TATA IPL 2026 player list.</li>
            <li>Ratings, prices and squad scores are the game's own estimates, not real valuations.</li>
          </ul>
        </section>

        <section className="section">
          <h2>Things you add</h2>
          <p>If you add songs or photos, you are responsible for having the right to use them. They stay on your device.</p>
        </section>

        <section className="section">
          <h2>No warranty</h2>
          <p>The game is provided as is. Data may contain mistakes, and features may change or stop working at any time.</p>
        </section>

        <Link to="/privacy">Privacy policy</Link>
      </main>
    </>
  );
}
