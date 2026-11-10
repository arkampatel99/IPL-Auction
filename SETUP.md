# Setup

How to run, update and deploy IPL Auction Room.

## Requirements

- Node.js 20 or newer (22 recommended) and npm
- For refreshing player data only: `pdftotext` (from poppler-utils, e.g. `sudo apt install poppler-utils`)

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build and local preview:

```bash
npm run build        # outputs to dist/
npm run preview      # http://localhost:4173
```

## Project layout

```
scripts/
  build-players.mjs        builds src/data/players.json from open data
  import-auction-list.mjs  parses the official IPL 2026 auction list PDF
  fetch-open-photos.mjs    looks for openly licensed player photos (Openverse)
  data/                    parsed auction list and photo credits (committed)
src/
  data/                    players.json, teams.ts
  game/                    rules, player ratings, auction engine, bots, squad ratings (no React)
  net/                     friends rooms (PeerJS)
  screens/                 Home, setup, retention/release, auction, results, rooms, legal pages
  ui/                      shared components, theme, voice, music, photo/song storage
public/
  favicon.svg, icons, site.webmanifest
  sounds/<TEAM>.mp3        team songs (not in git, see below)
  players/<name>.jpg       player photos (not in git, see below)
```

All auction numbers (purses, retention slabs, squad limits, bid steps, timer) live in `src/game/rules.ts`.

## Player data

`src/data/players.json` is generated and committed, so the app never scrapes at runtime.
To refresh it (for a new season):

```bash
node scripts/import-auction-list.mjs   # official auction list PDF -> scripts/data/ipl-2026-auction-list.json
npm run data                           # downloads Cricsheet + Wikidata into .cache/ and rebuilds players.json
npm run photos                         # optional: more openly licensed photos from Openverse
```

Sources: Cricsheet ball-by-ball data (IPL, T20Is, ODIs, BBL, SA20, PSL, CPL, ILT20, MLC, The Hundred, BPL, T20 Blast),
the Cricsheet people register, and Wikidata / Wikimedia Commons for names and free photos.

## Team songs and player photos

These are not stored in git. Add them locally:

- **Songs:** `public/sounds/CSK.mp3`, `MI.mp3`, `RCB.mp3`, `KKR.mp3`, `SRH.mp3`, `RR.mp3`, `DC.mp3`, `PBKS.mp3`, `LSG.mp3`, `GT.mp3`.
  Start times are set in `src/data/teams.ts` (`song: { start }`) and each clip plays for 5 seconds.
  Teams without a file play a generated tune.
- **Photos:** `public/players/<player-name>.jpg`, file name in lower case with dashes, e.g. `devon-conway.jpg`.
  Players without any photo show a team-colour silhouette.

Only use songs and photos you have the right to use, especially on a public deployment.

The in-app **Team songs** and **Player photos** editors are hidden from visitors. They show when running
`npm run dev`, or after opening the site once with `?admin=1` (`?admin=0` hides them again).

## Deploy to Vercel

```bash
npx vercel login       # one time
npx vercel --prod      # deploys this folder
```

`vercel.json` sends every path to `index.html`, so direct links such as invite links `/r/CODE` work.
`.vercelignore` uploads `public/sounds` and `public/players` but skips `node_modules`, `dist` and `.cache`.

Deploying from GitHub instead also works, but songs and photos are not in the repository, so that deployment
will use generated tunes and Wikimedia photos only.

Custom domain: Vercel dashboard, your project, Settings, Domains.

## Friends rooms

Play with Friends uses PeerJS (WebRTC). The host's browser runs the auction and friends connect to it directly,
introduced by PeerJS's free public server. No accounts or server setup are needed. If the host closes the tab,
the room ends.

- Everyone in the room picks their own squad first: retentions in a mega auction, releases in a mini auction.
  The auction starts when all have confirmed. The host can start early, and bots then choose for anyone still picking.
- Friends can join after the auction has started: they open the invite link and take over a bot's team.
  The host finds the link in the auction **Menu** (Copy invite link). If a friend leaves, a bot takes their team back.
- Team chips show who plays each team (name, You, or Bot), and the Menu lists everyone in the room.

### Connection routes

1. **Direct** (WebRTC via PeerJS): used first, fastest, works on most Wi-Fi.
2. **Backup relay**: if the direct route doesn't open within 7 seconds (common on mobile data, where carriers
   block phone-to-phone links), the app switches by itself to a relay through the public HiveMQ MQTT broker over
   a secure WebSocket (`src/net/relay.ts`). No account needed. Game updates are gzipped and sent up to 2.5 times a second.
   Add `?relay=1` to an invite link to force the relay. Set `VITE_RELAY_URL` to use another broker.

The public broker is shared: room messages are not private, so don't send anything personal in names.
For a private relay, set `VITE_RELAY_URL` to your own broker, or add a TURN server with
`VITE_TURN_CREDENTIALS_URL` (Metered) or `VITE_TURN_URL` + `VITE_TURN_USERNAME` + `VITE_TURN_CREDENTIAL`.
