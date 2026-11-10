export type TeamId = 'CSK' | 'MI' | 'RCB' | 'KKR' | 'SRH' | 'RR' | 'DC' | 'PBKS' | 'LSG' | 'GT';

export interface Team {
  id: TeamId;
  name: string;
  color: string; // solid brand colour
  ink: string;   // text colour on top of `color`
  city: string;  // what the auctioneer calls the team
  chant: string; // fan chant / slogan, shown and called out when the team buys a player
  /** Team song: public/sounds/<ID>.mp3, played for a few seconds from `start` (seconds). */
  song: { start: number };
}

/** Official logo, served by the IPL site. TeamLogo falls back to a colour badge if it fails. */
export const logoUrl = (id: TeamId) => `https://scores.iplt20.com/ipl/teamlogos/${id}.png`;

export const TEAMS: Team[] = [
  { id: 'CSK', chant: 'Whistle Podu!', city: 'Chennai', name: 'Chennai Super Kings', color: '#F9CD05', ink: '#15171A', song: { start: 0 } },
  { id: 'MI', chant: 'Duniya Hila Denge!', city: 'Mumbai', name: 'Mumbai Indians', color: '#004BA0', ink: '#FFFFFF', song: { start: 0 } },
  { id: 'RCB', chant: 'RCB! RCB! Ee Sala Cup Namde!', city: 'Bengaluru', name: 'Royal Challengers Bengaluru', color: '#C8102E', ink: '#FFFFFF', song: { start: 0 } },
  { id: 'KKR', chant: 'Korbo Lorbo Jeetbo!', city: 'Kolkata', name: 'Kolkata Knight Riders', color: '#3A225D', ink: '#FFFFFF', song: { start: 0 } },
  { id: 'SRH', chant: 'Orange Army!', city: 'Hyderabad', name: 'Sunrisers Hyderabad', color: '#F26522', ink: '#15171A', song: { start: 0 } },
  { id: 'RR', chant: 'Halla Bol!', city: 'Rajasthan', name: 'Rajasthan Royals', color: '#E4007C', ink: '#FFFFFF', song: { start: 0 } },
  { id: 'DC', chant: 'Roar Macha!', city: 'Delhi', name: 'Delhi Capitals', color: '#17449B', ink: '#FFFFFF', song: { start: 14 } },
  { id: 'PBKS', chant: 'Sadda Punjab!', city: 'Punjab', name: 'Punjab Kings', color: '#DD1F2D', ink: '#FFFFFF', song: { start: 35 } },
  { id: 'LSG', chant: 'Ab Apni Baari Hai!', city: 'Lucknow', name: 'Lucknow Super Giants', color: '#0A9BD7', ink: '#FFFFFF', song: { start: 46 } },
  { id: 'GT', chant: 'Aava De!', city: 'Gujarat', name: 'Gujarat Titans', color: '#1B2133', ink: '#FFFFFF', song: { start: 10 } },
];

export const TEAM_IDS = TEAMS.map(t => t.id);
export const teamById = Object.fromEntries(TEAMS.map(t => [t.id, t])) as Record<TeamId, Team>;
