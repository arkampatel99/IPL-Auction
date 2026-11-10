// Song and photo editors are for the site owner only. They show when running locally (npm run dev),
// or after visiting the site once with ?admin=1 (and are hidden again with ?admin=0).
const KEY = 'ipl-auction-admin';

function read(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('admin');
    if (q === '1') localStorage.setItem(KEY, '1');
    if (q === '0') localStorage.removeItem(KEY);
    return import.meta.env.DEV || localStorage.getItem(KEY) === '1';
  } catch {
    return import.meta.env.DEV;
  }
}

export const isAdmin = read();
