// Every auction number lives here. All money is in lakhs (100 L = 1 Cr).

export type AuctionMode = 'mega' | 'mini';
export type BotLevel = 'easy' | 'medium' | 'hard';

export const RULES = {
  megaPurse: 12000,          // ₹120 Cr
  miniCap: 12500,            // ₹125 Cr salary cap
  minPurseMini: 500,
  maxPurseMini: 6500,
  squadMin: 18,
  squadMax: 25,
  overseasMax: 8,
  maxRetentions: 6,
  maxCappedRetentions: 5,
  maxUncappedRetentions: 2,
  cappedSlabs: [1800, 1400, 1100, 1800, 1400],
  uncappedSlab: 400,
  minBase: 30,
  basePrices: [30, 75, 100, 150, 200], // the only base prices used in the game
  timerChoices: [10, 15, 20],
  timerAfterBid: 10,         // seconds left after every bid
  quickPoolSize: 180,
  quickOverseasMax: 70,       // at most this many overseas players in a quick mega pool
  quickMiniSize: 150,        // first 150 of the official list (sets 1–19)
  // Purse each team took into the real IPL 2026 auction (Abu Dhabi, 16 Dec 2025), in lakhs.
  miniPurse2026: { KKR: 6430, CSK: 4340, SRH: 2550, LSG: 2295, DC: 2180, RCB: 1640, RR: 1605, GT: 1290, PBKS: 1150, MI: 275 },
} as const;

/** Every raise is the same size, so the auto-bid slider lands exactly on real bids. */
export const BID_STEP = 25;

/** Next bid after `current` (null = opening bid at base price). */
export function nextBid(current: number | null, base: number): number {
  return current === null ? base : current + BID_STEP;
}

/** The highest real bid (base + whole steps) at or below `limit`. */
export function bidAtOrBelow(limit: number, base: number): number {
  return limit < base ? base : base + Math.floor((limit - base) / BID_STEP) * BID_STEP;
}

/** Cost of each retention, in the order players were picked. */
export function retentionCosts(capped: boolean[]): number[] {
  let c = 0;
  return capped.map(isCapped => (isCapped ? RULES.cappedSlabs[c++] ?? 1400 : RULES.uncappedSlab));
}
