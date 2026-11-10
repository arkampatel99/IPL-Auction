import { useEffect, useMemo, useState } from 'react';
import { PLAYERS, roleLabel } from '../game/players';
import { PlayerPhoto, TeamLogo, TopBar } from '../ui/common';
import { onPhotosChange, photoSlug, removePhoto, savePhoto, savedPhoto } from '../ui/photoStore';

type Filter = 'missing' | 'list' | 'all';
const PAGE = 60;

/** Add a photo for any player: find one on Google Images, save it, then pick the file here. */
export default function Photos() {
  const [v, setV] = useState(0);
  useEffect(() => onPhotosChange(() => setV(v => v + 1)), []);
  const [filter, setFilter] = useState<Filter>('missing');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const hasPhoto = (id: string, img: string) => Boolean(savedPhoto(id) || img);
  const rows = useMemo(() => PLAYERS
    .filter(p => filter === 'all' || (filter === 'list' ? p.auction : !hasPhoto(p.id, p.img)))
    .filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.auction?.sr ?? 999) - (b.auction?.sr ?? 999) || b.rating - a.rating),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [filter, q, v]);
  const missing = PLAYERS.filter(p => !hasPhoto(p.id, p.img)).length;
  const [note, setNote] = useState('');

  /** Paste a copied image ("Copy image" in Google Images) onto a player. */
  const paste = async (id: string, name: string) => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) { await savePhoto(id, await item.getType(type)); setNote(`Added photo for ${name}.`); return; }
      }
      setNote('No image on the clipboard. In Google Images, right-click a photo and choose "Copy image" first.');
    } catch {
      setNote('Your browser blocked clipboard access. Allow it, or use Add photo.');
    }
  };

  /** Many files at once, matched to players by file name ("Yash Dhull.jpg" or "yash-dhull.png"). */
  const addMany = async (files: FileList | null) => {
    if (!files) return;
    const bySlug = new Map(PLAYERS.map(p => [photoSlug(p.name), p]));
    let ok = 0;
    const unmatched: string[] = [];
    for (const f of Array.from(files)) {
      const p = bySlug.get(photoSlug(f.name.replace(/\.[a-z0-9]+$/i, '')));
      if (p) { await savePhoto(p.id, f); ok++; } else unmatched.push(f.name);
    }
    setNote(`Added ${ok} ${ok === 1 ? 'photo' : 'photos'}.${unmatched.length ? ` No player matched: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? '…' : ''}` : ''}`);
  };

  return (
    <>
      <TopBar back />
      <main className="page stack">
        <div className="hero">
          <h1>Player photos</h1>
          <p className="muted"><b className="num">{missing}</b> without a photo · Find → copy image → Paste</p>
        </div>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="btn primary">
            Add many (name files after players)
            <input type="file" accept="image/*" multiple hidden onChange={e => { void addMany(e.target.files); e.target.value = ''; }} />
          </label>
          {note && <span className={`status ${/^(Added|Removed)/.test(note) ? 'ok' : 'err'}`} role="status">{note}</span>}
        </div>

        <div className="filters card" style={{ borderRadius: 8 }}>
          <input className="input" style={{ minHeight: 36 }} placeholder="Search players" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />
          {([['missing', 'No photo'], ['list', '2026 auction list'], ['all', 'All players']] as [Filter, string][]).map(([f, label]) => (
            <button key={f} type="button" className={`btn sm${filter === f ? ' primary' : ''}`} onClick={() => { setFilter(f); setPage(1); }}>{label}</button>
          ))}
        </div>

        <div className="card list">
          {rows.slice(0, page * PAGE).map(p => {
            const mine = savedPhoto(p.id);
            const query = encodeURIComponent(`${p.name} IPL cricketer`);
            return (
              <div key={p.id} className="list-row photo-row">
                <PlayerPhoto player={p} size={44} />
                <div className="grow">
                  <div className="name">{p.name}</div>
                  <div className="small muted">
                    {roleLabel(p)}{p.auction ? ` · ${p.auction.set}` : ''} · file: {photoSlug(p.name)}.jpg
                  </div>
                </div>
                {p.lastTeam && <TeamLogo id={p.lastTeam} size={22} />}
                <a className="btn sm" href={`https://www.google.com/search?tbm=isch&q=${query}`} target="_blank" rel="noreferrer">Find photo</a>
                <button type="button" className="btn sm" onClick={() => void paste(p.id, p.name)}>Paste</button>
                <label className="btn sm primary">
                  {mine ? 'Change' : 'Add photo'}
                  <input type="file" accept="image/*" hidden onChange={e => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    if (!f.type.startsWith('image/')) { setNote('That is not an image. Pick a JPG, PNG or WebP.'); return; }
                    savePhoto(p.id, f).then(() => setNote(`Added photo for ${p.name}.`)).catch(() => setNote('Could not save that photo. Your browser may be out of storage space.'));
                  }} />
                </label>
                {mine && <button type="button" className="btn sm ghost" onClick={() => { void removePhoto(p.id).then(() => setNote(`Removed photo for ${p.name}.`)); }}>Remove</button>}
              </div>
            );
          })}
          {!rows.length && <div className="list-row muted small">Every player here has a photo.</div>}
        </div>
        {rows.length > page * PAGE && (
          <button type="button" className="btn block" onClick={() => setPage(n => n + 1)}>Show more ({rows.length - page * PAGE} left)</button>
        )}
      </main>
    </>
  );
}
