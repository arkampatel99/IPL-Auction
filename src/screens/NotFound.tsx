import { Link } from 'react-router-dom';
import { TopBar } from '../ui/common';

export default function NotFound() {
  return (
    <>
      <TopBar back="/" />
      <main className="page stack" style={{ alignItems: 'flex-start' }}>
        <div className="hero">
          <span className="kicker">404</span>
          <h1>This page doesn't exist</h1>
          <p className="muted">The link may be old or mistyped.</p>
        </div>
        <Link to="/" className="btn primary big">Go to home</Link>
      </main>
    </>
  );
}
