// ── State ───────────────────────────────────────────────────────────────────
let allMatches = [];
let allScorers = [];
let allGroups  = [];
let loaded     = { groups: false, scorers: false, stats: false };

// ── API ─────────────────────────────────────────────────────────────────────
async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  }) + ' UTC';
}

function fmtShortDate(iso) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  });
}

const STAGE_LABEL = {
  FINAL: 'Final', THIRD_PLACE: 'Third Place', SEMI_FINALS: 'Semi-Finals',
  QUARTER_FINALS: 'Quarter-Finals', ROUND_OF_16: 'Round of 16', GROUP_STAGE: 'Group Stage'
};
const STAGE_ORDER = ['FINAL','THIRD_PLACE','SEMI_FINALS','QUARTER_FINALS','ROUND_OF_16','GROUP_STAGE'];

function stageLabel(s) { return STAGE_LABEL[s] || s; }

function crest(team, size = 30) {
  if (team.crest) {
    return `<img src="${team.crest}" class="team-crest" width="${size}" height="${size}" alt="${team.tla}" onerror="this.outerHTML=placeholder('${team.tla||'?'}')">`;
  }
  return placeholder(team.tla || '?', size);
}

function placeholder(tla, size = 30) {
  return `<div class="crest-placeholder" style="width:${size}px;height:${size}px;font-size:${size*.22}px">${(tla||'?').slice(0,3)}</div>`;
}

function totalGoals(score) {
  const ft = score?.fullTime;
  return ft ? (ft.home || 0) + (ft.away || 0) : 0;
}

function isLive(status) {
  return ['IN_PLAY','PAUSED','HALFTIME'].includes(status);
}

// ── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${id}`));
    if (id === 'groups' && !loaded.groups) loadGroups();
    if (id === 'scorers' && !loaded.scorers) loadScorers();
    if (id === 'stats' && !loaded.stats) renderStats();
    if (id === 'docs') document.getElementById('base-url').textContent = `${location.origin}/api`;
  });
});

// ── Init ─────────────────────────────────────────────────────────────────────
document.getElementById('base-url').textContent = `${location.origin}/api`;

(async () => {
  try {
    const [matchData, scorerData] = await Promise.all([
      get('/api/matches'),
      get('/api/scorers')
    ]);

    if (matchData.demo) document.getElementById('demo-badge').classList.remove('hidden');

    allMatches = matchData.matches;
    allScorers = scorerData.scorers || [];

    // Check for live matches
    if (allMatches.some(m => isLive(m.status))) {
      document.getElementById('live-indicator').classList.remove('hidden');
    }

    renderOverview();
    renderMatches(allMatches);

    // Preload groups for stats
    const groupData = await get('/api/groups');
    allGroups = groupData.standings || [];
    loaded.groups = true;

  } catch (e) {
    console.error('Init error', e);
  }
})();

// ── Overview ─────────────────────────────────────────────────────────────────
function renderOverview() {
  const finished = allMatches.filter(m => m.status === 'FINISHED');
  const goals = finished.reduce((sum, m) => sum + totalGoals(m.score), 0);
  const draws = finished.filter(m => m.score?.winner === 'DRAW').length;
  const teams = new Set([...allMatches.map(m => m.homeTeam.id), ...allMatches.map(m => m.awayTeam.id)]).size;
  const avgGoals = finished.length ? (goals / finished.length).toFixed(2) : '—';

  // Biggest win
  let biggestWin = '—';
  let biggestDiff = 0;
  finished.forEach(m => {
    const ft = m.score?.fullTime;
    if (ft) {
      const diff = Math.abs((ft.home || 0) - (ft.away || 0));
      if (diff > biggestDiff) {
        biggestDiff = diff;
        biggestWin = `${Math.max(ft.home, ft.away)}–${Math.min(ft.home, ft.away)}`;
      }
    }
  });

  document.getElementById('stat-goals').textContent = goals;
  document.getElementById('stat-played').textContent = finished.length;
  document.getElementById('stat-avg').textContent = avgGoals;
  document.getElementById('stat-teams').textContent = teams;
  document.getElementById('stat-biggest').textContent = biggestWin;
  document.getElementById('stat-draws').textContent = draws;

  // Recent results (last 6 finished, newest first)
  const recent = [...finished]
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
    .slice(0, 6);

  document.getElementById('recent-matches').innerHTML = recent.length
    ? recent.map(miniMatchCard).join('')
    : '<div class="no-events">No results yet.</div>';

  // Upcoming (next 6 scheduled)
  const upcoming = allMatches
    .filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED')
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .slice(0, 6);

  document.getElementById('upcoming-matches').innerHTML = upcoming.length
    ? upcoming.map(miniUpcomingCard).join('')
    : '<div class="no-events">No upcoming matches.</div>';

  // Scorers snapshot
  document.getElementById('overview-scorers').innerHTML = allScorers.length
    ? `<div class="scorers-overview">${allScorers.slice(0, 8).map((s, i) => scorerMiniCard(s, i)).join('')}</div>`
    : '<div class="no-events">No scorer data.</div>';

  // Click on mini match cards
  document.querySelectorAll('[data-match-id]').forEach(el => {
    el.addEventListener('click', () => openMatch(el.dataset.matchId));
  });
}

function miniMatchCard(m) {
  const ft = m.score?.fullTime;
  const score = ft ? `${ft.home}–${ft.away}` : '–';
  return `
    <div class="mini-match" data-match-id="${m.id}">
      <div class="mini-teams">
        <span class="mini-team">${m.homeTeam.shortName || m.homeTeam.name}</span>
        <span class="mini-score">${score}</span>
        <span class="mini-team" style="text-align:right">${m.awayTeam.shortName || m.awayTeam.name}</span>
      </div>
      <span class="mini-time">${fmtShortDate(m.utcDate)}</span>
    </div>`;
}

function miniUpcomingCard(m) {
  return `
    <div class="mini-match">
      <div class="mini-teams">
        <span class="mini-team">${m.homeTeam.shortName || m.homeTeam.name}</span>
        <span class="mini-score" style="color:var(--text3)">vs</span>
        <span class="mini-team" style="text-align:right">${m.awayTeam.shortName || m.awayTeam.name}</span>
      </div>
      <span class="mini-time">${fmtShortDate(m.utcDate)}</span>
    </div>`;
}

function scorerMiniCard(s, i) {
  const rank = i + 1;
  const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-other';
  const initials = (s.player?.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2);
  return `
    <div class="scorer-mini">
      <span class="scorer-mini-rank ${rankClass}">${rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank}</span>
      <div class="scorer-mini-info">
        <div class="scorer-mini-name">${s.player?.name || '—'}</div>
        <div class="scorer-mini-team">${s.team?.name || ''}</div>
      </div>
      <span class="scorer-mini-goals">${s.goals}</span>
    </div>`;
}

// ── Matches ──────────────────────────────────────────────────────────────────
function renderMatches(matches) {
  const container = document.getElementById('matches-container');
  document.getElementById('match-count').textContent = `${matches.length} match${matches.length !== 1 ? 'es' : ''}`;

  if (!matches.length) {
    container.innerHTML = '<div class="loading">No matches found.</div>';
    return;
  }

  const byStage = {};
  matches.forEach(m => (byStage[m.stage] = byStage[m.stage] || []).push(m));

  const html = STAGE_ORDER.filter(s => byStage[s]).map(s => `
    <div class="stage-section">
      <div class="stage-label">${stageLabel(s)}</div>
      <div class="matches-grid">${byStage[s].map(matchCard).join('')}</div>
    </div>`).join('');

  container.innerHTML = html;

  container.querySelectorAll('.match-card').forEach(card => {
    card.addEventListener('click', () => openMatch(card.dataset.id));
  });
}

function matchCard(m) {
  const ft = m.score?.fullTime;
  const pens = m.score?.penalties;
  const ht = m.score?.halfTime;
  const live = isLive(m.status);

  let scoreMain = '–';
  let scoreSub = '';

  if (ft && m.status !== 'SCHEDULED' && m.status !== 'TIMED') {
    scoreMain = `${ft.home ?? '–'} – ${ft.away ?? '–'}`;
    if (pens) scoreSub = `Pens ${pens.home}–${pens.away}`;
    else if (ht) scoreSub = `HT ${ht.home}–${ht.away}`;
  } else if (live) {
    scoreMain = ft ? `${ft.home ?? 0} – ${ft.away ?? 0}` : '– –';
  }

  const badge = live
    ? `<span class="status-pill pill-live">🔴 Live</span>`
    : m.status === 'FINISHED'
    ? `<span class="status-pill pill-ft">FT</span>`
    : `<span class="status-pill pill-sched">${fmtShortDate(m.utcDate)}</span>`;

  const groupInfo = m.group ? m.group.replace('GROUP_','Group ') : '';

  return `
    <div class="match-card ${live ? 'live-card' : ''}" data-id="${m.id}">
      <div class="card-top">
        <span class="card-meta">${fmtShortDate(m.utcDate)}</span>
        ${groupInfo ? `<span class="card-group">${groupInfo}</span>` : ''}
      </div>
      <div class="match-teams">
        <div class="team-side home">
          ${crest(m.homeTeam)}
          <span class="team-name">${m.homeTeam.name}</span>
        </div>
        <div class="score-center">
          <div class="score-main">${scoreMain}</div>
          ${scoreSub ? `<div class="score-sub">${scoreSub}</div>` : ''}
        </div>
        <div class="team-side away">
          ${crest(m.awayTeam)}
          <span class="team-name">${m.awayTeam.name}</span>
        </div>
      </div>
      <div class="card-footer">
        ${badge}
        <span class="hint-click">Click for events →</span>
      </div>
    </div>`;
}

// Filters
['stage-filter','status-filter','group-filter'].forEach(id => {
  document.getElementById(id).addEventListener('change', applyFilters);
});

function applyFilters() {
  const stage  = document.getElementById('stage-filter').value;
  const status = document.getElementById('status-filter').value;
  const group  = document.getElementById('group-filter').value;

  let filtered = allMatches;
  if (stage)  filtered = filtered.filter(m => m.stage === stage);
  if (group)  filtered = filtered.filter(m => m.group === group);
  if (status) {
    if (status === 'IN_PLAY') filtered = filtered.filter(m => isLive(m.status));
    else if (status === 'SCHEDULED') filtered = filtered.filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED');
    else filtered = filtered.filter(m => m.status === status);
  }
  renderMatches(filtered);
}

// ── Groups ───────────────────────────────────────────────────────────────────
async function loadGroups() {
  loaded.groups = true;
  const container = document.getElementById('groups-container');
  try {
    if (!allGroups.length) {
      const data = await get('/api/groups');
      allGroups = data.standings || [];
    }
    container.innerHTML = `<div class="groups-grid">${allGroups.map(groupCard).join('')}</div>`;
  } catch (e) {
    container.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

function groupCard(g) {
  const letter = g.group?.replace('GROUP_','') || '?';
  const rows = (g.table || []).map(r => `
    <tr>
      <td>${r.position}</td>
      <td>${r.team?.name || '—'}</td>
      <td>${r.playedGames ?? 0}</td>
      <td>${r.won ?? 0}</td>
      <td>${r.draw ?? 0}</td>
      <td>${r.lost ?? 0}</td>
      <td>${r.goalsFor ?? 0}</td>
      <td>${r.goalsAgainst ?? 0}</td>
      <td class="td-gd">${(r.goalDifference ?? 0) > 0 ? '+' : ''}${r.goalDifference ?? 0}</td>
      <td class="td-pts">${r.points ?? 0}</td>
    </tr>`).join('');

  return `
    <div class="group-card">
      <div class="group-head">
        <span class="group-name">Group ${letter}</span>
      </div>
      <table class="group-table">
        <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Scorers ──────────────────────────────────────────────────────────────────
async function loadScorers() {
  loaded.scorers = true;
  const container = document.getElementById('scorers-container');
  try {
    if (!allScorers.length) {
      const data = await get('/api/scorers');
      allScorers = data.scorers || [];
    }
    container.innerHTML = `<div class="scorers-full">${allScorers.map(scorerRow).join('')}</div>`;
  } catch (e) {
    container.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  }
}

function scorerRow(s, i) {
  const rank = i + 1;
  const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : '';
  const medal = rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank;
  const initials = (s.player?.name || '??').split(' ').slice(-2).map(w => w[0]).join('');

  return `
    <div class="scorer-row">
      <span class="scorer-pos ${rankClass}">${medal}</span>
      <div class="scorer-avatar">${initials}</div>
      <div class="scorer-info">
        <div class="scorer-name">${s.player?.name || '—'}</div>
        <div class="scorer-team">${s.team?.name || ''} · ${s.playedMatches ?? 0} matches</div>
      </div>
      <div class="scorer-stats-row">
        <div class="sstat">
          <span class="sstat-val">${s.goals ?? 0}</span>
          <span class="sstat-lbl">Goals</span>
        </div>
        ${s.assists != null ? `<div class="sstat sstat-assist"><span class="sstat-val">${s.assists}</span><span class="sstat-lbl">Assists</span></div>` : ''}
        ${s.penalties ? `<div class="sstat sstat-pen"><span class="sstat-val">${s.penalties}</span><span class="sstat-lbl">Pens</span></div>` : ''}
      </div>
    </div>`;
}

// ── Stats ────────────────────────────────────────────────────────────────────
function renderStats() {
  loaded.stats = true;
  const container = document.getElementById('stats-container');
  const finished = allMatches.filter(m => m.status === 'FINISHED');

  if (!finished.length) {
    container.innerHTML = '<div class="loading">No completed matches yet.</div>';
    return;
  }

  // Goals per team from group standings
  const teamGoals = [];
  allGroups.forEach(g => {
    (g.table || []).forEach(r => {
      if (r.team && r.goalsFor) teamGoals.push({ name: r.team.name, goals: r.goalsFor });
    });
  });
  teamGoals.sort((a, b) => b.goals - a.goals);
  const maxGoals = teamGoals[0]?.goals || 1;

  // Top matches by total goals
  const topMatches = [...finished]
    .filter(m => m.score?.fullTime)
    .sort((a, b) => totalGoals(b.score) - totalGoals(a.score))
    .slice(0, 6);

  // Result breakdown
  const wins  = finished.filter(m => m.score?.winner && m.score.winner !== 'DRAW').length;
  const draws = finished.filter(m => m.score?.winner === 'DRAW').length;
  const maxBar = Math.max(wins, draws, 1);

  // Goals by matchday
  const byMatchday = {};
  finished.forEach(m => {
    if (m.matchday && m.score?.fullTime) {
      byMatchday[m.matchday] = (byMatchday[m.matchday] || 0) + totalGoals(m.score);
    }
  });
  const matchdays = Object.keys(byMatchday).sort((a,b) => a-b);
  const maxMd = Math.max(...Object.values(byMatchday), 1);

  // Stage breakdown
  const stageGoals = {};
  finished.forEach(m => {
    stageGoals[m.stage] = (stageGoals[m.stage] || 0) + totalGoals(m.score);
  });

  container.innerHTML = `
    <div class="stats-grid">

      <div class="stats-card">
        <div class="stats-card-title">Top Scoring Teams</div>
        <div class="bar-list">
          ${teamGoals.slice(0, 8).map(t => `
            <div class="bar-item">
              <span class="bar-label">${t.name}</span>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.round(t.goals/maxGoals*100)}%"></div></div>
              <span class="bar-val">${t.goals}</span>
            </div>`).join('')}
        </div>
      </div>

      <div class="stats-card">
        <div class="stats-card-title">Highest Scoring Matches</div>
        <div class="top-matches-list">
          ${topMatches.map(m => {
            const ft = m.score.fullTime;
            const total = totalGoals(m.score);
            return `
              <div class="top-match-item">
                <span class="top-match-score">${ft.home}–${ft.away}</span>
                <span class="top-match-teams">${m.homeTeam.shortName || m.homeTeam.name} vs ${m.awayTeam.shortName || m.awayTeam.name}</span>
                <span class="top-match-total">${total} goals</span>
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="stats-card">
        <div class="stats-card-title">Match Result Breakdown</div>
        <div class="result-bars" style="height:90px">
          <div class="result-col">
            <div class="result-bar-wrap">
              <div class="result-bar bar-wins" style="height:${Math.round(wins/maxBar*100)}%"></div>
            </div>
            <span class="result-count" style="color:var(--accent)">${wins}</span>
            <span class="result-label">Wins</span>
          </div>
          <div class="result-col">
            <div class="result-bar-wrap">
              <div class="result-bar bar-draws" style="height:${Math.round(draws/maxBar*100)}%"></div>
            </div>
            <span class="result-count" style="color:var(--accent2)">${draws}</span>
            <span class="result-label">Draws</span>
          </div>
        </div>
        <div style="margin-top:1rem">
          <div class="stats-card-title">Goals by Stage</div>
          <div class="bar-list">
            ${Object.entries(stageGoals).map(([s, g]) => `
              <div class="bar-item">
                <span class="bar-label">${stageLabel(s)}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${Math.round(g/Math.max(...Object.values(stageGoals))*100)}%;background:linear-gradient(90deg,var(--accent2),var(--accent))"></div></div>
                <span class="bar-val">${g}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>

      ${matchdays.length ? `
      <div class="stats-card">
        <div class="stats-card-title">Goals per Matchday</div>
        <div class="goals-timeline">
          ${matchdays.map(md => `
            <div class="gt-bar-wrap">
              <div class="gt-bar" style="height:${Math.round(byMatchday[md]/maxMd*100)}%" title="Matchday ${md}: ${byMatchday[md]} goals"></div>
            </div>`).join('')}
        </div>
        <div class="gt-labels">
          ${matchdays.map(md => `<div class="gt-lbl">${md}</div>`).join('')}
        </div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:.5rem;text-align:center">Matchday</div>
      </div>` : ''}

    </div>`;
}

// ── Match Modal ───────────────────────────────────────────────────────────────
const modal = document.getElementById('modal');
document.getElementById('modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function closeModal() { modal.classList.add('hidden'); }

async function openMatch(id) {
  modal.classList.remove('hidden');
  document.getElementById('modal-content').innerHTML = '<div class="loading">Loading match details...</div>';
  try {
    const m = await get(`/api/matches/${id}`);
    document.getElementById('modal-content').innerHTML = buildMatchDetail(m);
  } catch (e) {
    document.getElementById('modal-content').innerHTML = `<div class="loading">Error loading details.</div>`;
  }
}

function buildMatchDetail(m) {
  const ft  = m.score?.fullTime;
  const pens = m.score?.penalties;
  const ht  = m.score?.halfTime;
  const et  = m.score?.extraTime;

  let scoreMain = ft ? `${ft.home ?? 0} – ${ft.away ?? 0}` : '–';
  let scoreSub = '';
  if (pens) scoreSub += `Penalties: ${pens.home}–${pens.away} · `;
  if (et)   scoreSub += `AET · `;
  if (ht)   scoreSub += `Half-time: ${ht.home}–${ht.away}`;
  scoreSub = scoreSub.replace(/ · $/, '');

  const homeId  = m.homeTeam?.id;
  const goals   = m.goals || [];
  const bookings = m.bookings || [];
  const subs    = m.substitutions || [];

  function side(teamId) { return teamId === homeId ? 'home' : 'away'; }

  // Build sorted event list
  const events = [
    ...goals.map(g => ({ ...g, _type: 'goal', sort: g.minute + (g.injuryTime || 0) * .01 })),
    ...bookings.map(b => ({ ...b, _type: 'book', sort: b.minute })),
    ...subs.map(s => ({ ...s, _type: 'sub', sort: s.minute }))
  ].sort((a, b) => a.sort - b.sort);

  // Split into first half / second half / ET
  const firstHalf  = events.filter(e => e.minute <= 45);
  const secondHalf = events.filter(e => e.minute > 45 && e.minute <= 90);
  const extraTime  = events.filter(e => e.minute > 90);

  function evHtml(ev) {
    if (ev._type === 'goal') {
      const isSide = side(ev.team?.id);
      const typeNote = ev.type === 'PENALTY' ? ' (pen)' : ev.type === 'OWN_GOAL' ? ' (og)' : '';
      const assist = ev.assist ? ` · Assist: ${ev.assist.name}` : '';
      return `<div class="event goal ${isSide}">
        <span class="ev-min">${ev.minute}${ev.injuryTime ? `+${ev.injuryTime}` : ''}'</span>
        <span class="ev-icon">⚽</span>
        <div class="ev-text">
          <div class="ev-player">${ev.scorer?.name || '?'}${typeNote}</div>
          <div class="ev-detail">${ev.team?.name || ''}${assist}</div>
        </div>
      </div>`;
    }
    if (ev._type === 'book') {
      const isRed = ev.card === 'RED_CARD' || ev.card === 'YELLOW_RED_CARD';
      const isSide = side(ev.team?.id);
      return `<div class="event ${isRed ? 'red' : 'yellow'} ${isSide}">
        <span class="ev-min">${ev.minute}'</span>
        <span class="ev-icon">${isRed ? '🟥' : '🟨'}</span>
        <div class="ev-text">
          <div class="ev-player">${ev.player?.name || '?'}</div>
          <div class="ev-detail">${ev.team?.name || ''} · ${(ev.card || '').replace(/_/g,' ')}</div>
        </div>
      </div>`;
    }
    if (ev._type === 'sub') {
      const isSide = side(ev.team?.id);
      return `<div class="event sub ${isSide}">
        <span class="ev-min">${ev.minute}'</span>
        <span class="ev-icon">🔄</span>
        <div class="ev-text">
          <div class="ev-player">↑ ${ev.playerIn?.name || '?'} / ↓ ${ev.playerOut?.name || '?'}</div>
          <div class="ev-detail">${ev.team?.name || ''}</div>
        </div>
      </div>`;
    }
    return '';
  }

  const hasSections = firstHalf.length || secondHalf.length || extraTime.length;

  const timelineHtml = hasSections ? `
    ${firstHalf.length ? firstHalf.map(evHtml).join('') : ''}
    ${secondHalf.length ? `<div class="ht-divider">Half Time</div>${secondHalf.map(evHtml).join('')}` : ''}
    ${extraTime.length ? `<div class="ht-divider">Full Time</div>${extraTime.map(evHtml).join('')}` : ''}
  ` : `<div class="no-events">No detailed event data available for this match.</div>`;

  // Goals summary by team
  const homeGoals = goals.filter(g => g.team?.id === homeId);
  const awayGoals = goals.filter(g => g.team?.id !== homeId);

  return `
    <div class="detail-stage">${stageLabel(m.stage)}</div>

    <div class="detail-scoreboard">
      <div class="detail-team">
        ${crest(m.homeTeam, 52)}
        <div class="detail-team-name">${m.homeTeam?.name || '—'}</div>
        <div class="detail-team-tla">${m.homeTeam?.tla || ''}</div>
      </div>
      <div class="detail-score-box">
        <div class="detail-score">${scoreMain}</div>
        ${scoreSub ? `<div class="detail-score-sub">${scoreSub}</div>` : ''}
      </div>
      <div class="detail-team">
        ${crest(m.awayTeam, 52)}
        <div class="detail-team-name">${m.awayTeam?.name || '—'}</div>
        <div class="detail-team-tla">${m.awayTeam?.tla || ''}</div>
      </div>
    </div>

    <div class="detail-date">${fmtDate(m.utcDate)}</div>

    ${goals.length ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:1rem;font-size:.78rem">
      <div style="text-align:right;color:var(--accent)">
        ${homeGoals.map(g => `<div>${g.scorer?.name || '?'} ${g.minute}'</div>`).join('')}
      </div>
      <div style="color:var(--accent)">
        ${awayGoals.map(g => `<div>${g.scorer?.name || '?'} ${g.minute}'</div>`).join('')}
      </div>
    </div>` : ''}

    <div class="timeline-wrap">
      <div class="timeline-hdr">Match Events</div>
      <div class="timeline">${timelineHtml}</div>
    </div>`;
}
