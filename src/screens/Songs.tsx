import { useState } from 'react';
import { TEAMS, type TeamId } from '../data/teams';
import { TeamLogo, TopBar } from '../ui/common';
import { removeSong, saveSong, savedSong } from '../ui/songStore';
import { previewSong, setSongTimes, songTimes, stopSong, teamSongUrl } from '../ui/music';

/** Pick an audio file per team from your device. It is stored only in this browser. */
export default function Songs() {
  const [, setVersion] = useState(0);
  const refresh = () => setVersion(v => v + 1);

  return (
    <>
      <TopBar back />
      <main className="page stack">
        <div className="hero">
          <h1>Team songs</h1>
          <p className="muted">Plays when the team buys a player. Set the start and length.</p>
        </div>
        <div className="card list">
          {TEAMS.map(t => <SongRow key={t.id} team={t.id} name={t.name} onChange={refresh} />)}
        </div>
        <button type="button" className="btn block" onClick={stopSong}>Stop playing</button>
      </main>
    </>
  );
}

function SongRow({ team, name, onChange }: { team: TeamId; name: string; onChange: () => void }) {
  const saved = savedSong(team);
  const official = songTimes(team);
  const [start, setStart] = useState(saved?.song.start ?? official.start);
  const [length, setLength] = useState(saved?.song.length ?? official.length);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) { setMsg({ ok: false, text: 'That is not an audio file. Pick an MP3, M4A or WAV.' }); return; }
    setBusy(true);
    try {
      await saveSong({ team, name: file.name, blob: file, start, length });
      setMsg({ ok: true, text: `Saved ${file.name}.` });
      onChange();
    } catch {
      setMsg({ ok: false, text: 'Could not save this file. Your browser may be out of storage space.' });
    } finally { setBusy(false); }
  };
  const update = async (s: number, l: number) => {
    setStart(s); setLength(l);
    if (saved) { await saveSong({ ...saved.song, start: s, length: l }); onChange(); }
    else setSongTimes(team, s, l);
  };

  return (
    <div className="song-row">
      <div className="row" style={{ gap: 12 }}>
        <TeamLogo id={team} size={40} />
        <div className="grow" style={{ minWidth: 0, flex: 1 }}>
          <div className="name">{name}</div>
          <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {saved ? `Your file: ${saved.song.name}` : `sounds/${team}.mp3`}
          </div>
        </div>
        <label className="btn sm">
          {busy ? 'Saving…' : saved ? 'Change file' : 'Use my own file'}
          <input type="file" accept="audio/*" hidden onChange={e => pick(e.target.files?.[0])} />
        </label>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {(
          <>
            <label className="small muted row" style={{ gap: 6 }}>
              Start at
              <input className="input num" style={{ width: 72, minHeight: 36 }} type="number" min={0} step={1} value={start}
                onChange={e => update(Math.max(0, +e.target.value), length)} /> s
            </label>
            <label className="small muted row" style={{ gap: 6 }}>
              Play for
              <input className="input num" style={{ width: 64, minHeight: 36 }} type="number" min={2} max={20} step={1} value={length}
                onChange={e => update(start, Math.min(20, Math.max(2, +e.target.value)))} /> s
            </label>
          </>
        )}
        <button type="button" className="btn sm" onClick={() => (saved ? previewSong(saved.url, start, length) : previewSong(teamSongUrl(team), start, length))}>Play</button>
        {saved && <button type="button" className="btn sm ghost" onClick={async () => { await removeSong(team); setMsg({ ok: true, text: 'Back to the team file.' }); onChange(); }}>Use team file</button>}
      </div>
      {msg && <p className={`status ${msg.ok ? 'ok' : 'err'}`} role="status">{msg.text}</p>}
    </div>
  );
}
