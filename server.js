const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.FOOTBALL_API_KEY || '';
const BASE_URL = 'https://api.football-data.org/v4';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory cache (10 min TTL)
const cache = {};
const CACHE_TTL = 10 * 60 * 1000;

async function footballApi(endpoint) {
  const now = Date.now();
  if (cache[endpoint] && now - cache[endpoint].ts < CACHE_TTL) {
    return cache[endpoint].data;
  }
  const res = await axios.get(`${BASE_URL}${endpoint}`, {
    headers: { 'X-Auth-Token': API_KEY }
  });
  cache[endpoint] = { data: res.data, ts: now };
  return res.data;
}

function trimMatch(m) {
  return {
    id: m.id,
    utcDate: m.utcDate,
    status: m.status,
    stage: m.stage,
    group: m.group || null,
    matchday: m.matchday || null,
    homeTeam: { id: m.homeTeam.id, name: m.homeTeam.name, shortName: m.homeTeam.shortName, tla: m.homeTeam.tla, crest: m.homeTeam.crest },
    awayTeam: { id: m.awayTeam.id, name: m.awayTeam.name, shortName: m.awayTeam.shortName, tla: m.awayTeam.tla, crest: m.awayTeam.crest },
    score: m.score
  };
}

// GET /api — API info
app.get('/api', (req, res) => {
  res.json({
    name: 'World Cup 2022 API',
    description: 'Free REST API for FIFA World Cup 2022 — scores, goals, cards, standings',
    base: `http://localhost:${PORT}/api`,
    demo: !API_KEY,
    endpoints: [
      { method: 'GET', path: '/api/matches', description: 'All 64 matches', query: ['stage', 'matchday'] },
      { method: 'GET', path: '/api/matches/:id', description: 'Single match with goals and cards' },
      { method: 'GET', path: '/api/groups', description: 'All 8 group standings' },
      { method: 'GET', path: '/api/groups/:letter', description: 'One group (A–H)' },
      { method: 'GET', path: '/api/scorers', description: 'Top scorers', query: ['limit'] },
      { method: 'GET', path: '/api/teams', description: 'All 32 teams' }
    ],
    stages: ['GROUP_STAGE', 'ROUND_OF_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'THIRD_PLACE', 'FINAL']
  });
});

// GET /api/matches
app.get('/api/matches', async (req, res) => {
  if (!API_KEY) return res.json({ matches: DEMO_MATCHES, total: DEMO_MATCHES.length, demo: true });
  try {
    const { stage, matchday } = req.query;
    let ep = '/competitions/WC/matches?season=2026';
    if (stage) ep += `&stage=${stage.toUpperCase()}`;
    if (matchday) ep += `&matchday=${matchday}`;
    const data = await footballApi(ep);
    res.json({ matches: data.matches.map(trimMatch), total: data.matches.length });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/matches/:id
app.get('/api/matches/:id', async (req, res) => {
  if (!API_KEY) {
    const demo = DEMO_MATCH_DETAILS[req.params.id] || DEMO_MATCH_DETAILS['final'];
    return res.json({ ...demo, demo: true });
  }
  try {
    const d = await footballApi(`/matches/${req.params.id}`);
    res.json({
      id: d.id,
      utcDate: d.utcDate,
      status: d.status,
      stage: d.stage,
      group: d.group || null,
      homeTeam: d.homeTeam,
      awayTeam: d.awayTeam,
      score: d.score,
      goals: (d.goals || []).map(g => ({
        minute: g.minute,
        injuryTime: g.injuryTime || null,
        type: g.type,
        team: { id: g.team?.id, name: g.team?.name },
        scorer: { id: g.scorer?.id, name: g.scorer?.name },
        assist: g.assist ? { id: g.assist.id, name: g.assist.name } : null
      })),
      bookings: (d.bookings || []).map(b => ({
        minute: b.minute,
        card: b.card,
        team: { id: b.team?.id, name: b.team?.name },
        player: { id: b.player?.id, name: b.player?.name }
      })),
      substitutions: (d.substitutions || []).map(s => ({
        minute: s.minute,
        team: { id: s.team?.id, name: s.team?.name },
        playerOut: { id: s.playerOut?.id, name: s.playerOut?.name },
        playerIn: { id: s.playerIn?.id, name: s.playerIn?.name }
      }))
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/groups
app.get('/api/groups', async (req, res) => {
  if (!API_KEY) return res.json({ standings: DEMO_GROUPS, demo: true });
  try {
    const data = await footballApi('/competitions/WC/standings?season=2026');
    res.json({ standings: data.standings });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/groups/:letter
app.get('/api/groups/:letter', async (req, res) => {
  const key = `GROUP_${req.params.letter.toUpperCase()}`;
  if (!API_KEY) {
    const g = DEMO_GROUPS.find(x => x.group === key);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    return res.json({ standings: g, demo: true });
  }
  try {
    const data = await footballApi('/competitions/WC/standings?season=2026');
    const g = data.standings.find(s => s.group === key);
    if (!g) return res.status(404).json({ error: 'Group not found' });
    res.json({ standings: g });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/scorers
app.get('/api/scorers', async (req, res) => {
  if (!API_KEY) return res.json({ scorers: DEMO_SCORERS, demo: true });
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const data = await footballApi(`/competitions/WC/scorers?season=2026&limit=${limit}`);
    res.json({ scorers: data.scorers });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// GET /api/teams
app.get('/api/teams', async (req, res) => {
  if (!API_KEY) return res.json({ teams: DEMO_TEAMS, total: DEMO_TEAMS.length, demo: true });
  try {
    const data = await footballApi('/competitions/WC/teams?season=2026');
    res.json({ teams: data.teams, total: data.teams.length });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// ─── Demo data (WC Qatar 2022) ───────────────────────────────────────────────

const DEMO_MATCHES = [
  // Final
  { id: 'final', utcDate: '2022-12-18T15:00:00Z', status: 'FINISHED', stage: 'FINAL', group: null, matchday: null,
    homeTeam: { id: 762, name: 'Argentina', shortName: 'Argentina', tla: 'ARG', crest: 'https://crests.football-data.org/762.png' },
    awayTeam: { id: 773, name: 'France', shortName: 'France', tla: 'FRA', crest: 'https://crests.football-data.org/773.png' },
    score: { winner: 'HOME_TEAM', duration: 'PENALTY_SHOOTOUT', fullTime: { home: 3, away: 3 }, halfTime: { home: 2, away: 0 }, extraTime: { home: 3, away: 3 }, penalties: { home: 4, away: 2 } }
  },
  // Third place
  { id: 'third', utcDate: '2022-12-17T15:00:00Z', status: 'FINISHED', stage: 'THIRD_PLACE', group: null, matchday: null,
    homeTeam: { id: 799, name: 'Croatia', shortName: 'Croatia', tla: 'CRO', crest: 'https://crests.football-data.org/799.png' },
    awayTeam: { id: 1031, name: 'Morocco', shortName: 'Morocco', tla: 'MAR', crest: 'https://crests.football-data.org/1031.png' },
    score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 2, away: 1 }, halfTime: { home: 2, away: 1 }, extraTime: null, penalties: null }
  },
  // Semi-finals
  { id: 'sf1', utcDate: '2022-12-13T19:00:00Z', status: 'FINISHED', stage: 'SEMI_FINALS', group: null, matchday: null,
    homeTeam: { id: 762, name: 'Argentina', shortName: 'Argentina', tla: 'ARG', crest: 'https://crests.football-data.org/762.png' },
    awayTeam: { id: 799, name: 'Croatia', shortName: 'Croatia', tla: 'CRO', crest: 'https://crests.football-data.org/799.png' },
    score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 3, away: 0 }, halfTime: { home: 2, away: 0 }, extraTime: null, penalties: null }
  },
  { id: 'sf2', utcDate: '2022-12-14T19:00:00Z', status: 'FINISHED', stage: 'SEMI_FINALS', group: null, matchday: null,
    homeTeam: { id: 773, name: 'France', shortName: 'France', tla: 'FRA', crest: 'https://crests.football-data.org/773.png' },
    awayTeam: { id: 1031, name: 'Morocco', shortName: 'Morocco', tla: 'MAR', crest: 'https://crests.football-data.org/1031.png' },
    score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 2, away: 0 }, halfTime: { home: 1, away: 0 }, extraTime: null, penalties: null }
  },
  // Quarter-finals
  { id: 'qf1', utcDate: '2022-12-09T15:00:00Z', status: 'FINISHED', stage: 'QUARTER_FINALS', group: null, matchday: null,
    homeTeam: { id: 799, name: 'Croatia', shortName: 'Croatia', tla: 'CRO', crest: 'https://crests.football-data.org/799.png' },
    awayTeam: { id: 759, name: 'Brazil', shortName: 'Brazil', tla: 'BRA', crest: 'https://crests.football-data.org/759.png' },
    score: { winner: 'HOME_TEAM', duration: 'PENALTY_SHOOTOUT', fullTime: { home: 1, away: 1 }, halfTime: { home: 0, away: 0 }, extraTime: { home: 1, away: 1 }, penalties: { home: 4, away: 2 } }
  },
  { id: 'qf2', utcDate: '2022-12-09T19:00:00Z', status: 'FINISHED', stage: 'QUARTER_FINALS', group: null, matchday: null,
    homeTeam: { id: 791, name: 'Netherlands', shortName: 'Netherlands', tla: 'NED', crest: 'https://crests.football-data.org/791.png' },
    awayTeam: { id: 762, name: 'Argentina', shortName: 'Argentina', tla: 'ARG', crest: 'https://crests.football-data.org/762.png' },
    score: { winner: 'AWAY_TEAM', duration: 'PENALTY_SHOOTOUT', fullTime: { home: 2, away: 2 }, halfTime: { home: 0, away: 1 }, extraTime: { home: 2, away: 2 }, penalties: { home: 3, away: 4 } }
  },
  { id: 'qf3', utcDate: '2022-12-10T15:00:00Z', status: 'FINISHED', stage: 'QUARTER_FINALS', group: null, matchday: null,
    homeTeam: { id: 1031, name: 'Morocco', shortName: 'Morocco', tla: 'MAR', crest: 'https://crests.football-data.org/1031.png' },
    awayTeam: { id: 765, name: 'Portugal', shortName: 'Portugal', tla: 'POR', crest: 'https://crests.football-data.org/765.png' },
    score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 1, away: 0 }, halfTime: { home: 1, away: 0 }, extraTime: null, penalties: null }
  },
  { id: 'qf4', utcDate: '2022-12-10T19:00:00Z', status: 'FINISHED', stage: 'QUARTER_FINALS', group: null, matchday: null,
    homeTeam: { id: 773, name: 'France', shortName: 'France', tla: 'FRA', crest: 'https://crests.football-data.org/773.png' },
    awayTeam: { id: 770, name: 'England', shortName: 'England', tla: 'ENG', crest: 'https://crests.football-data.org/770.png' },
    score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 2, away: 1 }, halfTime: { home: 1, away: 0 }, extraTime: null, penalties: null }
  },
  // Round of 16
  { id: 'r16-1', utcDate: '2022-12-03T15:00:00Z', status: 'FINISHED', stage: 'ROUND_OF_16', group: null, matchday: null,
    homeTeam: { id: 791, name: 'Netherlands', shortName: 'Netherlands', tla: 'NED', crest: 'https://crests.football-data.org/791.png' },
    awayTeam: { id: 768, name: 'United States', shortName: 'USA', tla: 'USA', crest: 'https://crests.football-data.org/768.png' },
    score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 3, away: 1 }, halfTime: { home: 0, away: 0 }, extraTime: null, penalties: null }
  },
  { id: 'r16-2', utcDate: '2022-12-03T19:00:00Z', status: 'FINISHED', stage: 'ROUND_OF_16', group: null, matchday: null,
    homeTeam: { id: 762, name: 'Argentina', shortName: 'Argentina', tla: 'ARG', crest: 'https://crests.football-data.org/762.png' },
    awayTeam: { id: 769, name: 'Australia', shortName: 'Australia', tla: 'AUS', crest: 'https://crests.football-data.org/769.png' },
    score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 2, away: 1 }, halfTime: { home: 1, away: 0 }, extraTime: null, penalties: null }
  },
  { id: 'r16-3', utcDate: '2022-12-04T15:00:00Z', status: 'FINISHED', stage: 'ROUND_OF_16', group: null, matchday: null,
    homeTeam: { id: 773, name: 'France', shortName: 'France', tla: 'FRA', crest: 'https://crests.football-data.org/773.png' },
    awayTeam: { id: 798, name: 'Poland', shortName: 'Poland', tla: 'POL', crest: 'https://crests.football-data.org/798.png' },
    score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 3, away: 1 }, halfTime: { home: 1, away: 0 }, extraTime: null, penalties: null }
  },
  { id: 'r16-4', utcDate: '2022-12-04T19:00:00Z', status: 'FINISHED', stage: 'ROUND_OF_16', group: null, matchday: null,
    homeTeam: { id: 770, name: 'England', shortName: 'England', tla: 'ENG', crest: 'https://crests.football-data.org/770.png' },
    awayTeam: { id: 1031, name: 'Senegal', shortName: 'Senegal', tla: 'SEN', crest: 'https://crests.football-data.org/1031.png' },
    score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 3, away: 0 }, halfTime: { home: 2, away: 0 }, extraTime: null, penalties: null }
  },
  { id: 'r16-5', utcDate: '2022-12-05T15:00:00Z', status: 'FINISHED', stage: 'ROUND_OF_16', group: null, matchday: null,
    homeTeam: { id: 797, name: 'Japan', shortName: 'Japan', tla: 'JPN', crest: 'https://crests.football-data.org/797.png' },
    awayTeam: { id: 799, name: 'Croatia', shortName: 'Croatia', tla: 'CRO', crest: 'https://crests.football-data.org/799.png' },
    score: { winner: 'AWAY_TEAM', duration: 'PENALTY_SHOOTOUT', fullTime: { home: 1, away: 1 }, halfTime: { home: 1, away: 0 }, extraTime: { home: 1, away: 1 }, penalties: { home: 1, away: 3 } }
  },
  { id: 'r16-6', utcDate: '2022-12-05T19:00:00Z', status: 'FINISHED', stage: 'ROUND_OF_16', group: null, matchday: null,
    homeTeam: { id: 759, name: 'Brazil', shortName: 'Brazil', tla: 'BRA', crest: 'https://crests.football-data.org/759.png' },
    awayTeam: { id: 776, name: 'South Korea', shortName: 'South Korea', tla: 'KOR', crest: 'https://crests.football-data.org/776.png' },
    score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 4, away: 1 }, halfTime: { home: 4, away: 0 }, extraTime: null, penalties: null }
  },
  { id: 'r16-7', utcDate: '2022-12-06T15:00:00Z', status: 'FINISHED', stage: 'ROUND_OF_16', group: null, matchday: null,
    homeTeam: { id: 1031, name: 'Morocco', shortName: 'Morocco', tla: 'MAR', crest: 'https://crests.football-data.org/1031.png' },
    awayTeam: { id: 760, name: 'Spain', shortName: 'Spain', tla: 'ESP', crest: 'https://crests.football-data.org/760.png' },
    score: { winner: 'HOME_TEAM', duration: 'PENALTY_SHOOTOUT', fullTime: { home: 0, away: 0 }, halfTime: { home: 0, away: 0 }, extraTime: { home: 0, away: 0 }, penalties: { home: 3, away: 0 } }
  },
  { id: 'r16-8', utcDate: '2022-12-06T19:00:00Z', status: 'FINISHED', stage: 'ROUND_OF_16', group: null, matchday: null,
    homeTeam: { id: 765, name: 'Portugal', shortName: 'Portugal', tla: 'POR', crest: 'https://crests.football-data.org/765.png' },
    awayTeam: { id: 788, name: 'Switzerland', shortName: 'Switzerland', tla: 'SUI', crest: 'https://crests.football-data.org/788.png' },
    score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 6, away: 1 }, halfTime: { home: 2, away: 0 }, extraTime: null, penalties: null }
  },
  // Notable group stage matches
  { id: 'gs-final-arg', utcDate: '2022-11-22T10:00:00Z', status: 'FINISHED', stage: 'GROUP_STAGE', group: 'GROUP_C', matchday: 1,
    homeTeam: { id: 762, name: 'Argentina', shortName: 'Argentina', tla: 'ARG', crest: 'https://crests.football-data.org/762.png' },
    awayTeam: { id: 784, name: 'Saudi Arabia', shortName: 'Saudi Arabia', tla: 'KSA', crest: 'https://crests.football-data.org/784.png' },
    score: { winner: 'AWAY_TEAM', duration: 'REGULAR', fullTime: { home: 1, away: 2 }, halfTime: { home: 1, away: 0 }, extraTime: null, penalties: null }
  },
  { id: 'gs-ger-jpn', utcDate: '2022-11-23T13:00:00Z', status: 'FINISHED', stage: 'GROUP_STAGE', group: 'GROUP_E', matchday: 1,
    homeTeam: { id: 759, name: 'Germany', shortName: 'Germany', tla: 'GER', crest: 'https://crests.football-data.org/759.png' },
    awayTeam: { id: 797, name: 'Japan', shortName: 'Japan', tla: 'JPN', crest: 'https://crests.football-data.org/797.png' },
    score: { winner: 'AWAY_TEAM', duration: 'REGULAR', fullTime: { home: 1, away: 2 }, halfTime: { home: 1, away: 0 }, extraTime: null, penalties: null }
  },
  { id: 'gs-esp-ger', utcDate: '2022-11-27T19:00:00Z', status: 'FINISHED', stage: 'GROUP_STAGE', group: 'GROUP_E', matchday: 2,
    homeTeam: { id: 760, name: 'Spain', shortName: 'Spain', tla: 'ESP', crest: 'https://crests.football-data.org/760.png' },
    awayTeam: { id: 759, name: 'Germany', shortName: 'Germany', tla: 'GER', crest: 'https://crests.football-data.org/759.png' },
    score: { winner: 'DRAW', duration: 'REGULAR', fullTime: { home: 1, away: 1 }, halfTime: { home: 1, away: 0 }, extraTime: null, penalties: null }
  }
];

const DEMO_MATCH_DETAILS = {
  final: {
    id: 'final', utcDate: '2022-12-18T15:00:00Z', status: 'FINISHED', stage: 'FINAL', group: null,
    homeTeam: { id: 762, name: 'Argentina', shortName: 'Argentina', tla: 'ARG', crest: 'https://crests.football-data.org/762.png' },
    awayTeam: { id: 773, name: 'France', shortName: 'France', tla: 'FRA', crest: 'https://crests.football-data.org/773.png' },
    score: { winner: 'HOME_TEAM', duration: 'PENALTY_SHOOTOUT', fullTime: { home: 3, away: 3 }, halfTime: { home: 2, away: 0 }, extraTime: { home: 3, away: 3 }, penalties: { home: 4, away: 2 } },
    goals: [
      { minute: 23, injuryTime: null, type: 'PENALTY', team: { id: 762, name: 'Argentina' }, scorer: { id: 1, name: 'Lionel Messi' }, assist: null },
      { minute: 36, injuryTime: null, type: 'REGULAR', team: { id: 762, name: 'Argentina' }, scorer: { id: 2, name: 'Ángel Di María' }, assist: { id: 3, name: 'Julián Álvarez' } },
      { minute: 80, injuryTime: null, type: 'PENALTY', team: { id: 773, name: 'France' }, scorer: { id: 4, name: 'Kylian Mbappé' }, assist: null },
      { minute: 81, injuryTime: null, type: 'REGULAR', team: { id: 773, name: 'France' }, scorer: { id: 4, name: 'Kylian Mbappé' }, assist: { id: 5, name: 'Marcus Thuram' } },
      { minute: 108, injuryTime: null, type: 'REGULAR', team: { id: 762, name: 'Argentina' }, scorer: { id: 1, name: 'Lionel Messi' }, assist: null },
      { minute: 118, injuryTime: null, type: 'PENALTY', team: { id: 773, name: 'France' }, scorer: { id: 4, name: 'Kylian Mbappé' }, assist: null }
    ],
    bookings: [
      { minute: 64, card: 'YELLOW_CARD', team: { id: 762, name: 'Argentina' }, player: { id: 6, name: 'Nicolás Otamendi' } },
      { minute: 71, card: 'YELLOW_CARD', team: { id: 773, name: 'France' }, player: { id: 7, name: 'Ousmane Dembélé' } },
      { minute: 105, card: 'YELLOW_CARD', team: { id: 762, name: 'Argentina' }, player: { id: 8, name: 'Leandro Paredes' } },
      { minute: 113, card: 'YELLOW_CARD', team: { id: 773, name: 'France' }, player: { id: 9, name: 'Kingsley Coman' } }
    ],
    substitutions: [
      { minute: 41, team: { id: 773, name: 'France' }, playerOut: { name: 'Lucas Hernández' }, playerIn: { name: 'Theo Hernández' } },
      { minute: 71, team: { id: 773, name: 'France' }, playerOut: { name: 'Ousmane Dembélé' }, playerIn: { name: 'Randal Kolo Muani' } },
      { minute: 78, team: { id: 773, name: 'France' }, playerOut: { name: 'Olivier Giroud' }, playerIn: { name: 'Marcus Thuram' } },
      { minute: 106, team: { id: 762, name: 'Argentina' }, playerOut: { name: 'Ángel Di María' }, playerIn: { name: 'Leandro Paredes' } }
    ]
  },
  sf1: {
    id: 'sf1', utcDate: '2022-12-13T19:00:00Z', status: 'FINISHED', stage: 'SEMI_FINALS', group: null,
    homeTeam: { id: 762, name: 'Argentina', shortName: 'Argentina', tla: 'ARG', crest: 'https://crests.football-data.org/762.png' },
    awayTeam: { id: 799, name: 'Croatia', shortName: 'Croatia', tla: 'CRO', crest: 'https://crests.football-data.org/799.png' },
    score: { winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 3, away: 0 }, halfTime: { home: 2, away: 0 }, extraTime: null, penalties: null },
    goals: [
      { minute: 34, injuryTime: null, type: 'PENALTY', team: { id: 762, name: 'Argentina' }, scorer: { id: 1, name: 'Lionel Messi' }, assist: null },
      { minute: 39, injuryTime: null, type: 'REGULAR', team: { id: 762, name: 'Argentina' }, scorer: { id: 10, name: 'Julián Álvarez' }, assist: { id: 1, name: 'Lionel Messi' } },
      { minute: 69, injuryTime: null, type: 'REGULAR', team: { id: 762, name: 'Argentina' }, scorer: { id: 10, name: 'Julián Álvarez' }, assist: { id: 1, name: 'Lionel Messi' } }
    ],
    bookings: [
      { minute: 30, card: 'YELLOW_CARD', team: { id: 799, name: 'Croatia' }, player: { id: 11, name: 'Josip Juranović' } },
      { minute: 87, card: 'YELLOW_CARD', team: { id: 799, name: 'Croatia' }, player: { id: 12, name: 'Luka Modrić' } }
    ],
    substitutions: []
  },
  'gs-final-arg': {
    id: 'gs-final-arg', utcDate: '2022-11-22T10:00:00Z', status: 'FINISHED', stage: 'GROUP_STAGE', group: 'GROUP_C',
    homeTeam: { id: 762, name: 'Argentina', shortName: 'Argentina', tla: 'ARG', crest: 'https://crests.football-data.org/762.png' },
    awayTeam: { id: 784, name: 'Saudi Arabia', shortName: 'Saudi Arabia', tla: 'KSA', crest: 'https://crests.football-data.org/784.png' },
    score: { winner: 'AWAY_TEAM', duration: 'REGULAR', fullTime: { home: 1, away: 2 }, halfTime: { home: 1, away: 0 }, extraTime: null, penalties: null },
    goals: [
      { minute: 10, injuryTime: null, type: 'PENALTY', team: { id: 762, name: 'Argentina' }, scorer: { id: 1, name: 'Lionel Messi' }, assist: null },
      { minute: 48, injuryTime: null, type: 'REGULAR', team: { id: 784, name: 'Saudi Arabia' }, scorer: { id: 20, name: 'Salem Al-Dawsari' }, assist: null },
      { minute: 53, injuryTime: null, type: 'REGULAR', team: { id: 784, name: 'Saudi Arabia' }, scorer: { id: 21, name: 'Saleh Al-Shehri' }, assist: null }
    ],
    bookings: [
      { minute: 37, card: 'YELLOW_CARD', team: { id: 762, name: 'Argentina' }, player: { id: 13, name: 'Rodrigo De Paul' } },
      { minute: 58, card: 'YELLOW_CARD', team: { id: 784, name: 'Saudi Arabia' }, player: { id: 22, name: 'Mohammed Al-Burayk' } },
      { minute: 90, card: 'YELLOW_CARD', team: { id: 784, name: 'Saudi Arabia' }, player: { id: 23, name: 'Abdulelah Al-Amri' } }
    ],
    substitutions: []
  }
};

const DEMO_GROUPS = [
  {
    stage: 'GROUP_STAGE', type: 'TOTAL', group: 'GROUP_A',
    table: [
      { position: 1, team: { id: 791, name: 'Netherlands', crest: 'https://crests.football-data.org/791.png' }, playedGames: 3, won: 2, draw: 1, lost: 0, points: 7, goalsFor: 5, goalsAgainst: 1, goalDifference: 4 },
      { position: 2, team: { id: 1031, name: 'Senegal', crest: '' }, playedGames: 3, won: 2, draw: 0, lost: 1, points: 6, goalsFor: 5, goalsAgainst: 4, goalDifference: 1 },
      { position: 3, team: { id: 7850, name: 'Ecuador', crest: '' }, playedGames: 3, won: 1, draw: 1, lost: 1, points: 4, goalsFor: 4, goalsAgainst: 3, goalDifference: 1 },
      { position: 4, team: { id: 1842, name: 'Qatar', crest: '' }, playedGames: 3, won: 0, draw: 0, lost: 3, points: 0, goalsFor: 1, goalsAgainst: 7, goalDifference: -6 }
    ]
  },
  {
    stage: 'GROUP_STAGE', type: 'TOTAL', group: 'GROUP_B',
    table: [
      { position: 1, team: { id: 770, name: 'England', crest: 'https://crests.football-data.org/770.png' }, playedGames: 3, won: 2, draw: 1, lost: 0, points: 7, goalsFor: 9, goalsAgainst: 2, goalDifference: 7 },
      { position: 2, team: { id: 768, name: 'United States', crest: '' }, playedGames: 3, won: 1, draw: 2, lost: 0, points: 5, goalsFor: 2, goalsAgainst: 1, goalDifference: 1 },
      { position: 3, team: { id: 802, name: 'Iran', crest: '' }, playedGames: 3, won: 1, draw: 0, lost: 2, points: 3, goalsFor: 4, goalsAgainst: 7, goalDifference: -3 },
      { position: 4, team: { id: 775, name: 'Wales', crest: '' }, playedGames: 3, won: 0, draw: 1, lost: 2, points: 1, goalsFor: 1, goalsAgainst: 6, goalDifference: -5 }
    ]
  },
  {
    stage: 'GROUP_STAGE', type: 'TOTAL', group: 'GROUP_C',
    table: [
      { position: 1, team: { id: 762, name: 'Argentina', crest: 'https://crests.football-data.org/762.png' }, playedGames: 3, won: 2, draw: 0, lost: 1, points: 6, goalsFor: 5, goalsAgainst: 2, goalDifference: 3 },
      { position: 2, team: { id: 798, name: 'Poland', crest: '' }, playedGames: 3, won: 1, draw: 1, lost: 1, points: 4, goalsFor: 2, goalsAgainst: 2, goalDifference: 0 },
      { position: 3, team: { id: 794, name: 'Mexico', crest: '' }, playedGames: 3, won: 1, draw: 1, lost: 1, points: 4, goalsFor: 2, goalsAgainst: 3, goalDifference: -1 },
      { position: 4, team: { id: 784, name: 'Saudi Arabia', crest: '' }, playedGames: 3, won: 1, draw: 0, lost: 2, points: 3, goalsFor: 3, goalsAgainst: 5, goalDifference: -2 }
    ]
  },
  {
    stage: 'GROUP_STAGE', type: 'TOTAL', group: 'GROUP_D',
    table: [
      { position: 1, team: { id: 773, name: 'France', crest: 'https://crests.football-data.org/773.png' }, playedGames: 3, won: 2, draw: 0, lost: 1, points: 6, goalsFor: 6, goalsAgainst: 3, goalDifference: 3 },
      { position: 2, team: { id: 769, name: 'Australia', crest: '' }, playedGames: 3, won: 2, draw: 0, lost: 1, points: 6, goalsFor: 3, goalsAgainst: 4, goalDifference: -1 },
      { position: 3, team: { id: 782, name: 'Tunisia', crest: '' }, playedGames: 3, won: 1, draw: 1, lost: 1, points: 4, goalsFor: 1, goalsAgainst: 1, goalDifference: 0 },
      { position: 4, team: { id: 786, name: 'Denmark', crest: '' }, playedGames: 3, won: 0, draw: 1, lost: 2, points: 1, goalsFor: 1, goalsAgainst: 3, goalDifference: -2 }
    ]
  },
  {
    stage: 'GROUP_STAGE', type: 'TOTAL', group: 'GROUP_E',
    table: [
      { position: 1, team: { id: 797, name: 'Japan', crest: 'https://crests.football-data.org/797.png' }, playedGames: 3, won: 2, draw: 0, lost: 1, points: 6, goalsFor: 4, goalsAgainst: 3, goalDifference: 1 },
      { position: 2, team: { id: 760, name: 'Spain', crest: 'https://crests.football-data.org/760.png' }, playedGames: 3, won: 1, draw: 1, lost: 1, points: 4, goalsFor: 9, goalsAgainst: 3, goalDifference: 6 },
      { position: 3, team: { id: 759, name: 'Germany', crest: '' }, playedGames: 3, won: 1, draw: 1, lost: 1, points: 4, goalsFor: 6, goalsAgainst: 5, goalDifference: 1 },
      { position: 4, team: { id: 785, name: 'Costa Rica', crest: '' }, playedGames: 3, won: 1, draw: 0, lost: 2, points: 3, goalsFor: 3, goalsAgainst: 11, goalDifference: -8 }
    ]
  },
  {
    stage: 'GROUP_STAGE', type: 'TOTAL', group: 'GROUP_F',
    table: [
      { position: 1, team: { id: 1031, name: 'Morocco', crest: 'https://crests.football-data.org/1031.png' }, playedGames: 3, won: 2, draw: 1, lost: 0, points: 7, goalsFor: 4, goalsAgainst: 1, goalDifference: 3 },
      { position: 2, team: { id: 799, name: 'Croatia', crest: 'https://crests.football-data.org/799.png' }, playedGames: 3, won: 1, draw: 2, lost: 0, points: 5, goalsFor: 4, goalsAgainst: 1, goalDifference: 3 },
      { position: 3, team: { id: 771, name: 'Belgium', crest: '' }, playedGames: 3, won: 1, draw: 1, lost: 1, points: 4, goalsFor: 1, goalsAgainst: 2, goalDifference: -1 },
      { position: 4, team: { id: 794, name: 'Canada', crest: '' }, playedGames: 3, won: 0, draw: 0, lost: 3, points: 0, goalsFor: 2, goalsAgainst: 7, goalDifference: -5 }
    ]
  },
  {
    stage: 'GROUP_STAGE', type: 'TOTAL', group: 'GROUP_G',
    table: [
      { position: 1, team: { id: 759, name: 'Brazil', crest: 'https://crests.football-data.org/759.png' }, playedGames: 3, won: 2, draw: 0, lost: 1, points: 6, goalsFor: 3, goalsAgainst: 3, goalDifference: 0 },
      { position: 2, team: { id: 788, name: 'Switzerland', crest: '' }, playedGames: 3, won: 2, draw: 0, lost: 1, points: 6, goalsFor: 4, goalsAgainst: 3, goalDifference: 1 },
      { position: 3, team: { id: 793, name: 'Cameroon', crest: '' }, playedGames: 3, won: 1, draw: 0, lost: 2, points: 3, goalsFor: 4, goalsAgainst: 4, goalDifference: 0 },
      { position: 4, team: { id: 801, name: 'Serbia', crest: '' }, playedGames: 3, won: 0, draw: 0, lost: 3, points: 0, goalsFor: 5, goalsAgainst: 8, goalDifference: -3 }
    ]
  },
  {
    stage: 'GROUP_STAGE', type: 'TOTAL', group: 'GROUP_H',
    table: [
      { position: 1, team: { id: 765, name: 'Portugal', crest: 'https://crests.football-data.org/765.png' }, playedGames: 3, won: 2, draw: 0, lost: 1, points: 6, goalsFor: 6, goalsAgainst: 4, goalDifference: 2 },
      { position: 2, team: { id: 776, name: 'South Korea', crest: '' }, playedGames: 3, won: 1, draw: 1, lost: 1, points: 4, goalsFor: 4, goalsAgainst: 4, goalDifference: 0 },
      { position: 3, team: { id: 803, name: 'Uruguay', crest: '' }, playedGames: 3, won: 1, draw: 1, lost: 1, points: 4, goalsFor: 2, goalsAgainst: 2, goalDifference: 0 },
      { position: 4, team: { id: 780, name: 'Ghana', crest: '' }, playedGames: 3, won: 1, draw: 0, lost: 2, points: 3, goalsFor: 5, goalsAgainst: 7, goalDifference: -2 }
    ]
  }
];

const DEMO_SCORERS = [
  { player: { id: 4, name: 'Kylian Mbappé', nationality: 'France' }, team: { id: 773, name: 'France' }, goals: 8, assists: 3, penalties: 3 },
  { player: { id: 1, name: 'Lionel Messi', nationality: 'Argentina' }, team: { id: 762, name: 'Argentina' }, goals: 7, assists: 3, penalties: 3 },
  { player: { id: 30, name: 'Olivier Giroud', nationality: 'France' }, team: { id: 773, name: 'France' }, goals: 4, assists: 0, penalties: 0 },
  { player: { id: 10, name: 'Julián Álvarez', nationality: 'Argentina' }, team: { id: 762, name: 'Argentina' }, goals: 4, assists: 0, penalties: 0 },
  { player: { id: 31, name: 'Marcus Rashford', nationality: 'England' }, team: { id: 770, name: 'England' }, goals: 3, assists: 0, penalties: 1 },
  { player: { id: 32, name: 'Cody Gakpo', nationality: 'Netherlands' }, team: { id: 791, name: 'Netherlands' }, goals: 3, assists: 1, penalties: 0 },
  { player: { id: 33, name: 'Enner Valencia', nationality: 'Ecuador' }, team: { id: 7850, name: 'Ecuador' }, goals: 3, assists: 0, penalties: 2 },
  { player: { id: 34, name: 'Gonçalo Ramos', nationality: 'Portugal' }, team: { id: 765, name: 'Portugal' }, goals: 3, assists: 0, penalties: 0 },
  { player: { id: 35, name: 'Richarlison', nationality: 'Brazil' }, team: { id: 759, name: 'Brazil' }, goals: 3, assists: 0, penalties: 0 },
  { player: { id: 36, name: 'Bukayo Saka', nationality: 'England' }, team: { id: 770, name: 'England' }, goals: 3, assists: 1, penalties: 0 }
];

const DEMO_TEAMS = [
  { id: 762, name: 'Argentina', shortName: 'Argentina', tla: 'ARG', crest: 'https://crests.football-data.org/762.png' },
  { id: 773, name: 'France', shortName: 'France', tla: 'FRA', crest: 'https://crests.football-data.org/773.png' },
  { id: 799, name: 'Croatia', shortName: 'Croatia', tla: 'CRO', crest: 'https://crests.football-data.org/799.png' },
  { id: 1031, name: 'Morocco', shortName: 'Morocco', tla: 'MAR', crest: 'https://crests.football-data.org/1031.png' },
  { id: 791, name: 'Netherlands', shortName: 'Netherlands', tla: 'NED', crest: 'https://crests.football-data.org/791.png' },
  { id: 765, name: 'Portugal', shortName: 'Portugal', tla: 'POR', crest: 'https://crests.football-data.org/765.png' },
  { id: 770, name: 'England', shortName: 'England', tla: 'ENG', crest: 'https://crests.football-data.org/770.png' },
  { id: 759, name: 'Brazil', shortName: 'Brazil', tla: 'BRA', crest: 'https://crests.football-data.org/759.png' },
  { id: 760, name: 'Spain', shortName: 'Spain', tla: 'ESP', crest: 'https://crests.football-data.org/760.png' },
  { id: 759, name: 'Germany', shortName: 'Germany', tla: 'GER', crest: '' },
  { id: 797, name: 'Japan', shortName: 'Japan', tla: 'JPN', crest: '' },
  { id: 776, name: 'South Korea', shortName: 'South Korea', tla: 'KOR', crest: '' }
];

app.listen(PORT, () => {
  console.log(`World Cup API  →  http://localhost:${PORT}`);
  console.log(`API info       →  http://localhost:${PORT}/api`);
  if (!API_KEY) {
    console.log('No API key — running with built-in WC2022 demo data.');
    console.log('Add FOOTBALL_API_KEY to .env for all 64 matches (free key at football-data.org).');
  }
});
