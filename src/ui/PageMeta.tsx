import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const SITE = 'IPL Auction Room';
const PAGES: Record<string, [string, string]> = {
  '/': [SITE, 'A fan-made IPL auction game. Pick a team, bid against 9 computer teams for real IPL players and build the best squad.'],
  '/bots': ['Play with Bots', 'Choose your team, mega or mini auction, and how tough the computer teams are.'],
  '/game': ['Auction', 'Your IPL auction in progress.'],
  '/friends': ['Play with Friends', 'Create a room and share the link, or join a friend\'s room with a code.'],
  '/room': ['Your room', 'Share the room code with friends and start the auction.'],
  '/songs': ['Team songs', 'Set the song each team plays when it buys a player.'],
  '/photos': ['Player photos', 'Add photos for players who do not have one yet.'],
  '/privacy': ['Privacy policy', 'What IPL Auction Room stores: only your own saves and settings, in your browser.'],
  '/terms': ['Terms and conditions', 'Terms for using IPL Auction Room, a free fan-made game.'],
};

/** Sets the page title and meta description for each screen. */
export default function PageMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const [title, description] = PAGES[pathname] ?? (pathname.startsWith('/r/') ? ['Join a room', 'Join a friend\'s IPL auction room.'] : ['Page not found', 'This page does not exist.']);
    document.title = pathname === '/' ? SITE : `${title} · ${SITE}`;
    let tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!tag) { tag = document.createElement('meta'); tag.name = 'description'; document.head.appendChild(tag); }
    tag.content = description;
  }, [pathname]);
  return null;
}
