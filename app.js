/* ═══════════════════════════════════════════════════════════
   CHESS PORTFOLIO v2 — app.js
   Clifford Jose · Lichess: clifford10
   Features: Live game analysis, best-move arrows, rating charts,
             board replay, openings, stats, achievements, animations
═══════════════════════════════════════════════════════════ */

'use strict';

/* ── Constants ─────────────────────────────────────────── */
const USERNAME = 'clifford10';
const LICHESS  = 'https://lichess.org';
const LIVE_POLL_MS = 4000;   // poll for active game every 4s
const EVAL_POLL_MS = 5000;   // re-fetch eval every 5s during game

/* ── Piece map ─────────────────────────────────────────── */
const PIECES = {
  wK: 'https://lichess1.org/assets/piece/cburnett/wK.svg',
  wQ: 'https://lichess1.org/assets/piece/cburnett/wQ.svg',
  wR: 'https://lichess1.org/assets/piece/cburnett/wR.svg',
  wB: 'https://lichess1.org/assets/piece/cburnett/wB.svg',
  wN: 'https://lichess1.org/assets/piece/cburnett/wN.svg',
  wP: 'https://lichess1.org/assets/piece/cburnett/wP.svg',
  bK: 'https://lichess1.org/assets/piece/cburnett/bK.svg',
  bQ: 'https://lichess1.org/assets/piece/cburnett/bQ.svg',
  bR: 'https://lichess1.org/assets/piece/cburnett/bR.svg',
  bB: 'https://lichess1.org/assets/piece/cburnett/bB.svg',
  bN: 'https://lichess1.org/assets/piece/cburnett/bN.svg',
  bP: 'https://lichess1.org/assets/piece/cburnett/bP.svg'
};

/* ── State ──────────────────────────────────────────────── */
let profileData    = null;
let gamesData      = null;
let ratingChart    = null;
let openingsChart  = null;
let currentTC      = 'bullet';

// Replay state
let repGame        = null;
let repChess       = null;
let repHistory     = [];
let repMoveIdx     = -1;
let repAutoTimer   = null;
let repEvalTimer   = null;

// Live game state
let liveGameId     = null;
let liveFen        = null;
let liveIsWhite    = true;
let liveLastMove   = null;
let liveTimer      = null;
let evalTimer      = null;
let customGameId   = null;

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  initNav();
  initCounters();
  initReplayBoard();
  initRatingChart();
  renderGames();
  renderOpenings();
  renderStats();
  renderAchievements();
  initScrollReveal();
  setFooterDate();
  // Init live board with start position
  renderLiveBoard(new Chess());
  
  // Init academy
  initAcademy();
  initTactics();
  initExplorer();

  // Init polling
  pollLiveGame();
  liveTimer = setInterval(pollLiveGame, LIVE_POLL_MS);

  const watchBtn = document.getElementById('watchCustomGame');
  if (watchBtn) {
    watchBtn.addEventListener('click', () => {
      const input = document.getElementById('customGameId');
      if (input && input.value.trim()) {
        customGameId = input.value.trim().split('/').pop().slice(0, 8);
        pollLiveGame();
      }
    });
  }
});

/* ═══════════════════════════════════════════════════════════
   DATA LOADING
═══════════════════════════════════════════════════════════ */
async function loadData() {
  try {
    const [pRes, gRes] = await Promise.all([
      fetch('data/profile.json'),
      fetch('data/games.json')
    ]);
    profileData = await pRes.json();
    gamesData   = await gRes.json();
  } catch {
    profileData = PROFILE;
    gamesData   = GAMES;
  }
}

/* ═══════════════════════════════════════════════════════════
   NAVBAR
═══════════════════════════════════════════════════════════ */
function initNav() {
  const nav = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('solid', window.scrollY > 10);
  }, { passive: true });
}

/* ═══════════════════════════════════════════════════════════
   ANIMATED COUNTERS
═══════════════════════════════════════════════════════════ */
function initCounters() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting && !e.target._done) {
        e.target._done = true;
        runCounter(e.target);
      }
    });
  }, { threshold: 0.3 });
  document.querySelectorAll('.counter').forEach(el => io.observe(el));
}

function runCounter(el) {
  const target = parseInt(el.dataset.target);
  const dur = 1600;
  const t0 = performance.now();
  const tick = (now) => {
    const p = Math.min((now - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * ease).toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ═══════════════════════════════════════════════════════════
   LIVE GAME ANALYSIS — Core Engine
═══════════════════════════════════════════════════════════ */
async function pollLiveGame() {
  try {
    let url = `${LICHESS}/api/user/${USERNAME}/current-game`;
    if (customGameId) {
      url = `${LICHESS}/game/export/${customGameId}?tags=false&clocks=false&evals=false`;
    }
    const res = await fetch(
      url,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) {
      setLiveIdle();
      return;
    }
    const game = await res.json();
    if (!game || !game.id) {
      setLiveIdle();
      return;
    }

    const isLive = game.status === 'started' || game.status === 'created';
    const gameId = game.id;

    if (gameId !== liveGameId) {
      liveGameId  = gameId;
      liveIsWhite = customGameId ? true : (game.players?.white?.user?.id === USERNAME.toLowerCase());
      liveLastMove = null;
      clearInterval(evalTimer);
      evalTimer = null;
    }

    // Update FEN & board by replaying moves
    const c = new Chess();
    if (game.initialFen && game.initialFen !== 'startpos') {
      c.load(game.initialFen);
    }
    let lastMoveSan = null;
    if (game.moves) {
      const moves = game.moves.split(' ');
      for (const move of moves) {
        if (move) {
          const m = c.move(move);
          if (m) lastMoveSan = m;
        }
      }
    }
    
    const fen = c.fen();
    if (fen && fen !== liveFen) {
      if (liveFen !== null && lastMoveSan) {
        const isCapture = lastMoveSan.flags.includes('c') || lastMoveSan.flags.includes('e');
        const snd = document.getElementById(isCapture ? 'sndCapture' : 'sndMove');
        if (snd) {
          snd.currentTime = 0;
          snd.play().catch(()=>{});
        }
      }
      liveFen = fen;
      liveLastMove = lastMoveSan ? lastMoveSan.from + lastMoveSan.to : null;
      renderLiveBoard(c, liveLastMove);
      fetchLiveEval(fen);
    }

    // Update UI
    setLiveActive(game);

    if (isLive) {
      if (!evalTimer) evalTimer = setInterval(() => fetchLiveEval(liveFen), EVAL_POLL_MS);
    } else {
      clearInterval(evalTimer);
      evalTimer = null;
      document.getElementById('liveStatusBadge').innerHTML = '<span class="live-badge" style="background:#555;color:#fff;box-shadow:none">FINISHED</span>';
      document.getElementById('liveCount').textContent = '🏁';
      document.getElementById('liveRefreshText').textContent = 'Game finished. Showing final position with analysis.';
    }

  } catch (err) {
    // Network error — keep showing current state
  }
}

function setLiveIdle() {
  if (liveGameId === null && !customGameId) return; // already idle
  liveGameId = null;
  liveFen    = null;
  customGameId = null;
  clearInterval(evalTimer);

  document.getElementById('livePanel').classList.remove('active-game');
  document.getElementById('liveBanner').classList.remove('visible');
  document.getElementById('liveStatusBadge').textContent = '● Waiting for game…';
  document.getElementById('liveOppInfo').style.display = 'none';
  document.getElementById('liveOpening').style.display = 'none';
  document.getElementById('liveClock').style.display   = 'none';
  document.getElementById('liveIdleState').style.display   = 'flex';
  document.getElementById('liveActiveState').style.display = 'none';
  document.getElementById('evalBarWrap').style.display = 'none';
  document.getElementById('liveCount').textContent = '—';
  clearArrows();

  // Reset board to start
  renderLiveBoard(new Chess());
  document.getElementById('liveRefreshText').textContent = 'Polling Lichess every 4 seconds…';
}

function setLiveActive(game) {
  document.getElementById('livePanel').classList.add('active-game');
  document.getElementById('liveBanner').classList.add('visible');
  document.getElementById('liveCount').textContent = '🔴';

  // Status badge
  const badge = document.getElementById('liveStatusBadge');
  badge.innerHTML = '<span class="live-badge"><span class="live-badge-dot"></span>LIVE</span>';

  // Opponent info
  const isWhite = game.players?.white?.user?.id === USERNAME.toLowerCase();
  const opp = isWhite ? game.players?.black : game.players?.white;
  document.getElementById('liveOppInfo').style.display = '';
  document.getElementById('liveOppName').textContent =
    opp?.user?.name ? `${opp.user.name} (${opp.rating||'?'})` : 'Anonymous';

  if (game.opening && game.opening.name) {
    const openingEl = document.getElementById('liveOpening');
    openingEl.textContent = game.opening.name;
    openingEl.style.display = 'inline';
  } else {
    document.getElementById('liveOpening').style.display = 'none';
  }

  // Clock doesn't come easily via current-game, so we hide it or show time control
  const clockEl = document.getElementById('liveClock');
  if (game.clock) {
    clockEl.style.display = '';
    const m = Math.floor(game.clock.initial / 60);
    const s = game.clock.increment;
    clockEl.textContent = `${m}+${s}`;
  } else {
    clockEl.style.display = 'none';
  }

  document.getElementById('liveIdleState').style.display    = 'none';
  document.getElementById('liveActiveState').style.display  = 'flex';
  document.getElementById('evalBarWrap').style.display      = '';

  const tc = game.speed ? game.speed.charAt(0).toUpperCase() + game.speed.slice(1) : 'Game';
  document.getElementById('liveRefreshText').textContent =
    `Live • ${tc} • Game ID: ${(game.id || '').slice(0, 8)}… • updates every 4s`;
}

/* Fetch local Stockfish evaluation for a FEN */
async function fetchLiveEval(fen) {
  if (!fen) return;
  
  try {
    let res = await fetch('https://chess-api.com/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, depth: 12, maxMoves: 3 })
    });
    let data = await res.json();
    
    // chess-api.com strict FEN validator rejects pseudo-legal EP squares.
    if (data && data.error === 'INVALID_FEN_VALIDATION_ERROR') {
      const safeFen = fen.replace(/ [a-h][36] /, ' - ');
      res = await fetch('https://chess-api.com/v1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: safeFen, depth: 12, maxMoves: 3 })
      });
      data = await res.json();
    }
    
    if (data && !data.error && data.text) {
      renderEval(data, fen);
    } else {
      showEvalUnavailable();
    }
  } catch(e) {
    showEvalUnavailable();
  }
}

function renderEval(data, fen) {
  // Update engine specs
  const specsEl = document.getElementById('liveEngineSpecs');
  if (specsEl) specsEl.textContent = `Stockfish 16.1 NNUE (Depth ${data.depth || 12})`;

  // Eval bar
  let cp = data.centipawns != null ? data.centipawns : (data.mate != null ? (data.mate > 0 ? 9999 : -9999) : 0);
  const evalEl = document.getElementById('evalFill');
  const evalScore = document.getElementById('evalScore');
  const pct = 50 + Math.max(-45, Math.min(45, cp / 50));
  evalEl.style.width = `${pct}%`;
  evalEl.classList.toggle('losing', cp < -50);

  if (data.mate != null) {
    evalScore.textContent = `M${Math.abs(data.mate)}`;
  } else {
    const sign = cp > 0 ? '+' : '';
    evalScore.textContent = `${sign}${(cp / 100).toFixed(2)}`;
  }

  // Best moves list
  const list = document.getElementById('bestMovesList');
  list.innerHTML = '';

  // Clear old arrows
  clearArrows();

  const item = document.createElement('div');
  item.className = 'best-move-item';
  item.style.flexDirection = 'column';
  item.style.alignItems = 'flex-start';
  item.style.padding = '0.75rem';
  item.style.gap = '0.5rem';
  
  const evalClass = cp > 30 ? 'pos' : cp < -30 ? 'neg' : 'eq';
  item.innerHTML = `
    <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
      <span class="bm-move" style="font-size:1.1rem; color:var(--text-1)">${data.san || data.move}</span>
      <span class="bm-eval ${evalClass}">${evalScore.textContent}</span>
    </div>
    <span style="font-size:0.85rem; color:var(--text-2); line-height:1.4">${data.text}</span>
  `;
  list.appendChild(item);

  // Draw arrow for this move
  if (data.lan && data.lan.length >= 4) {
    const from = data.lan.slice(0, 2);
    const to = data.lan.slice(2, 4);
    renderArrows([{ from, to }]);
  }
}

function showEvalUnavailable() {
  const list = document.getElementById('bestMovesList');
  if (list) list.innerHTML = `
    <div style="padding:1rem; color:var(--text-3); font-size:0.8rem; text-align:center">
      Eval not available for this position<br/>
      <span style="font-size:0.7rem">(API failed or rate limited)</span>
    </div>`;
  clearArrows();
}

/* ── Arrow Drawing ───────────────────────────────────────── */
function renderArrows(arrows) {
  clearArrows();
  const svg = document.getElementById('boardArrows');
  if (!svg || !arrows) return;

  const bRect = document.getElementById('liveBoardGrid').getBoundingClientRect();
  const cell = bRect.width / 8;

  arrows.forEach((arr, i) => {
    const fromXY = sqToXY(arr.from, cell, !liveIsWhite);
    const toXY   = sqToXY(arr.to, cell, !liveIsWhite);
    drawArrowSvg(svg, fromXY[0], fromXY[1], toXY[0], toXY[1], i + 1, cell);
  });
}

function drawArrowSvg(svg, fx, fy, tx, ty, rank, cell) {
  const dx = tx - fx, dy = ty - fy;
  const len = Math.sqrt(dx * dx + dy * dy);
  const shortenBy = cell * 0.35;
  const ex = tx - (dx / len) * shortenBy;
  const ey = ty - (dy / len) * shortenBy;

  const opacity = rank === 1 ? 0.88 : rank === 2 ? 0.55 : 0.3;
  const stroke  = rank === 1 ? 'rgba(77,201,148,0.9)' : rank === 2 ? 'rgba(77,201,148,0.6)' : 'rgba(77,201,148,0.35)';
  const sw      = rank === 1 ? cell * 0.18 : rank === 2 ? cell * 0.13 : cell * 0.09;

  // Circle on from-square
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', fx);
  circle.setAttribute('cy', fy);
  circle.setAttribute('r', cell * 0.22);
  circle.setAttribute('fill', stroke);
  circle.setAttribute('opacity', opacity * 0.5);
  svg.appendChild(circle);

  // Arrow line
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', fx);
  line.setAttribute('y1', fy);
  line.setAttribute('x2', ex);
  line.setAttribute('y2', ey);
  line.setAttribute('stroke', stroke);
  line.setAttribute('stroke-width', sw);
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('marker-end', `url(#arr-head-${rank})`);
  svg.appendChild(line);
}

function clearArrows() {
  const svg = document.getElementById('boardArrows');
  if (!svg) return;
  // Remove everything except <defs>
  Array.from(svg.children).forEach(c => {
    if (c.tagName !== 'defs') c.remove();
  });
}

function sqToXY(sq, cell, flip) {
  let file = sq.charCodeAt(0) - 97; // a=0..h=7
  let rank = 8 - parseInt(sq[1]);   // 8→0, 1→7
  if (flip) {
    file = 7 - file;
    rank = 7 - rank;
  }
  return [file * cell + cell / 2, rank * cell + cell / 2];
}

/* Convert UCI move to SAN using chess.js */
function uciToSan(uci, fen) {
  if (!uci || uci.length < 4) return uci;
  try {
    const c = new Chess(fen);
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);
    const promo = uci[4] || undefined;
    const move = c.move({ from, to, promotion: promo });
    return move ? move.san : uci;
  } catch { return uci; }
}

/* ── Live Board Render ──────────────────────────────────── */
function renderLiveBoard(chessInstance, lastMove) {
  const grid = document.getElementById('liveBoardGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const boardMap = {};
  chessInstance.board().forEach((row, ri) => {
    row.forEach((p, fi) => {
      if (p) boardMap[`${fi},${ri}`] = p;
    });
  });

  const lastSqs = new Set();
  if (lastMove && lastMove.length >= 4) {
    lastSqs.add(sqToCoord(lastMove.slice(0, 2)));
    lastSqs.add(sqToCoord(lastMove.slice(2, 4)));
  }

  const flip = !liveIsWhite;
  const ranks = flip ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const files = flip ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];

  for (let rank of ranks) {
    for (let file of files) {
      const cell = document.createElement('div');
      const isLight = (rank + file) % 2 === 0;
      cell.className = `b-cell ${isLight ? 'light' : 'dark'}`;

      const coord = `${file},${rank}`;
      if (lastSqs.has(coord)) {
        cell.classList.add(coord === sqToCoord((lastMove || '').slice(0, 2)) ? 'hi-from' : 'hi-to');
      }

      const piece = boardMap[coord];
      if (piece) {
        const url = PIECES[`${piece.color}${piece.type.toUpperCase()}`];
        if (url) cell.innerHTML = `<img src="${url}" alt="piece" style="width:85%;height:85%;pointer-events:none;">`;
      }

      grid.appendChild(cell);
    }
  }
}

function sqToCoord(sq) {
  if (!sq || sq.length < 2) return '';
  return `${sq.charCodeAt(0) - 97},${8 - parseInt(sq[1])}`;
}

/* ═══════════════════════════════════════════════════════════
   RATING CHART
═══════════════════════════════════════════════════════════ */
const TC_CFG = {
  bullet:    { color: '#E05C6B', fill: 'rgba(224,92,107,0.08)',  label: 'Bullet'    },
  blitz:     { color: '#4A90D9', fill: 'rgba(74,144,217,0.08)',  label: 'Blitz'     },
  rapid:     { color: '#D4A853', fill: 'rgba(212,168,83,0.08)',  label: 'Rapid'     },
  classical: { color: '#4DC994', fill: 'rgba(77,201,148,0.08)', label: 'Classical' }
};

function initRatingChart() {
  // Tab click handlers
  document.querySelectorAll('.c-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.c-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTC = btn.dataset.tc;
      updateChart(currentTC);
    });
  });

  // Build initial chart (bullet)
  const ctx = document.getElementById('ratingChart').getContext('2d');
  const data = profileData.ratingHistory.bullet || [];
  const cfg  = TC_CFG.bullet;

  ratingChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(p => fmtDate(p.date)),
      datasets: [{
        label: 'Bullet',
        data: data.map(p => p.rating),
        borderColor: cfg.color,
        backgroundColor: cfg.fill,
        borderWidth: 2,
        pointBackgroundColor: cfg.color,
        pointBorderColor: '#05060D',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 7,
        fill: true,
        tension: 0.45
      }]
    },
    options: chartOptions()
  });
  updatePills('bullet');
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0F101C',
        borderColor: 'rgba(212,168,83,0.25)',
        borderWidth: 1,
        titleColor: '#D4A853',
        bodyColor: '#EEF0F8',
        padding: 12,
        callbacks: {
          label: item => `  Rating: ${item.raw}`
        }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#50546A', font: { family: 'JetBrains Mono', size: 10 } }
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#50546A', font: { family: 'JetBrains Mono', size: 10 } },
        beginAtZero: false
      }
    }
  };
}

function updateChart(tc) {
  const data = profileData.ratingHistory[tc] || [];
  const cfg  = TC_CFG[tc];
  ratingChart.data.labels = data.map(p => fmtDate(p.date));
  ratingChart.data.datasets[0].data = data.map(p => p.rating);
  ratingChart.data.datasets[0].borderColor = cfg.color;
  ratingChart.data.datasets[0].backgroundColor = cfg.fill;
  ratingChart.data.datasets[0].pointBackgroundColor = cfg.color;
  ratingChart.data.datasets[0].label = cfg.label;
  ratingChart.update();
  updatePills(tc);
}

function updatePills(tc) {
  const ratings = (profileData.ratingHistory[tc] || []).map(p => p.rating);
  if (!ratings.length) return;
  const start   = ratings[0];
  const peak    = Math.max(...ratings);
  const current = ratings[ratings.length - 1];
  const gain    = current - start;
  document.getElementById('pillStart').textContent   = start;
  document.getElementById('pillPeak').textContent    = peak;
  document.getElementById('pillCurrent').textContent = current;
  document.getElementById('pillGain').textContent    = (gain >= 0 ? '+' : '') + gain;
}

function fmtDate(d) {
  const [y, m] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

/* ═══════════════════════════════════════════════════════════
   ACADEMY / INTERACTIVE BOOK
═══════════════════════════════════════════════════════════ */
let acChess = null;
let acHistory = [];
let acMoveIdx = -1;

let acSelectedSq = null;

async function initAcademy() {
  try {
    const res = await fetch('courses/lesson1.pgn');
    if (!res.ok) return;
    const pgn = await res.text();
    acChess = new Chess();
    acChess.load_pgn(pgn);
    acHistory = acChess.history({ verbose: true });
    
    const bookContainer = document.getElementById('acBook');
    let html = `<h3 style="color:var(--text-1); font-size:1.4rem; margin-bottom: 1rem;">Course: The Opera Game</h3>`;
    
    let tokens = pgn.replace(/\\[.*?\\]/g, '').replace(/\\r?\\n/g, ' ').split(/(\\{[^}]+\\}|\\d+\\.+|\\s+)/).filter(t => t.trim().length > 0);
    
    let moveCounter = 0;
    tokens.forEach(token => {
      if (token.startsWith('{')) {
        html += `<div style="background: rgba(77,201,148,0.1); border-left: 3px solid var(--primary); padding: 0.5rem; margin: 0.5rem 0; color: var(--text-2); font-size: 0.95rem;">${token.slice(1, -1)}</div>`;
      } else if (token.match(/^\\d+\\.+$/)) {
        html += `<strong style="color:var(--text-3); margin-right: 4px;">${token}</strong>`;
      } else if (!token.match(/^(1-0|0-1|1\\/2-1\\/2|\\*)$/)) {
        html += `<span class="ac-move-link" data-idx="${moveCounter}" style="color:var(--primary); cursor:pointer; padding: 2px 4px; border-radius: 4px; transition: 0.2s;">${token}</span> `;
        moveCounter++;
      }
    });
    
    bookContainer.innerHTML = html;
    
    document.querySelectorAll('.ac-move-link').forEach(el => {
      el.addEventListener('click', (e) => acGoTo(parseInt(e.target.dataset.idx)));
    });
    
    document.getElementById('acFirst').addEventListener('click', () => acGoTo(-1));
    document.getElementById('acPrev').addEventListener('click', () => acGoTo(acMoveIdx - 1));
    document.getElementById('acNext').addEventListener('click', () => acGoTo(acMoveIdx + 1));
    document.getElementById('acLast').addEventListener('click', () => acGoTo(acHistory.length - 1));
    document.getElementById('acFlip').addEventListener('click', () => {
      document.getElementById('acBoardGrid').classList.toggle('flipped');
      acGoTo(acMoveIdx);
    });
    
    acGoTo(-1);
  } catch (e) {
    console.error('Academy load failed', e);
  }
}

function acGoTo(idx) {
  if (idx < -1) idx = -1;
  if (idx >= acHistory.length) idx = acHistory.length - 1;
  acMoveIdx = idx;
  
  const temp = new Chess();
  for (let i = 0; i <= idx; i++) {
    temp.move(acHistory[i].san);
  }
  
  document.querySelectorAll('.ac-move-link').forEach(el => {
    el.style.background = 'transparent';
    el.style.color = 'var(--primary)';
  });
  if (idx >= 0) {
    const activeEl = document.querySelector(`.ac-move-link[data-idx="${idx}"]`);
    if (activeEl) {
      activeEl.style.background = 'var(--primary)';
      activeEl.style.color = '#000';
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  
  document.getElementById('acMoveLbl').textContent = `Move ${idx + 1} / ${acHistory.length}`;
  renderAcBoard(temp, idx >= 0 ? acHistory[idx] : null);
}

function renderAcBoard(game, moveObj) {
  const grid = document.getElementById('acBoardGrid');
  grid.innerHTML = '';
  const board = game.board();
  
  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      const cell = document.createElement('div');
      cell.className = `board-cell ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
      const alg = String.fromCharCode(97 + c) + (8 - r);
      
      if (moveObj && (moveObj.from === alg || moveObj.to === alg)) {
        cell.classList.add('hl');
      }
      if (acSelectedSq === alg) {
        cell.style.backgroundColor = 'rgba(77,201,148,0.5)';
      }
      
      if (sq) {
        const img = document.createElement('img');
        img.src = PIECES[sq.color + sq.type.toUpperCase()];
        cell.appendChild(img);
      }
      
      // Click-to-move logic
      cell.addEventListener('click', () => {
        // If the lesson is over, don't allow moves
        if (acMoveIdx >= acHistory.length - 1) return;
        
        if (!acSelectedSq) {
          // Select piece if it's the correct turn's color
          if (sq && sq.color === game.turn()) {
            acSelectedSq = alg;
            renderAcBoard(game, moveObj);
          }
        } else {
          // Attempt move
          if (acSelectedSq === alg) {
            acSelectedSq = null; // deselect
            renderAcBoard(game, moveObj);
            return;
          }
          
          const nextCorrectMove = acHistory[acMoveIdx + 1];
          // Simple validation using chess.js
          const tempGame = new Chess(game.fen());
          const moveAttempt = tempGame.move({ from: acSelectedSq, to: alg, promotion: 'q' });
          
          if (moveAttempt) {
            // It's a pseudo-legal move
            if (moveAttempt.san === nextCorrectMove.san) {
              // Correct move!
              acSelectedSq = null;
              acGoTo(acMoveIdx + 1);
            } else {
              // Incorrect move for this lesson
              grid.style.animation = 'shake 0.4s';
              setTimeout(() => grid.style.animation = '', 400);
              acSelectedSq = null;
              renderAcBoard(game, moveObj);
            }
          } else {
            // Invalid move, check if clicked another own piece
            if (sq && sq.color === game.turn()) {
              acSelectedSq = alg;
              renderAcBoard(game, moveObj);
            } else {
              acSelectedSq = null;
              renderAcBoard(game, moveObj);
            }
          }
        }
      });
      
      grid.appendChild(cell);
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   DAILY TACTICS TRAINER
═══════════════════════════════════════════════════════════ */
let tacChess = null;
let tacSolution = [];
let tacMoveIdx = 0;
let tacSelectedSq = null;
let tacBoardFlipped = false;

async function initTactics() {
  try {
    const res = await fetch('https://lichess.org/api/puzzle/daily');
    if (!res.ok) return;
    const data = await res.json();
    
    tacChess = new Chess();
    const pgnMoves = data.game.pgn.split(' ');
    for (const move of pgnMoves) {
      if (!move.includes('.')) {
        tacChess.move(move);
      }
    }
    
    tacSolution = data.puzzle.solution;
    tacMoveIdx = 0;
    
    document.getElementById('tacRating').textContent = `Rating: ${data.puzzle.rating}`;
    document.getElementById('tacMsg').textContent = 'Find the best move!';
    document.getElementById('tacMsg').style.color = 'var(--text-1)';
    
    const blunder = tacSolution[0];
    const from = blunder.substring(0, 2);
    const to = blunder.substring(2, 4);
    const prom = blunder.length > 4 ? blunder[4] : undefined;
    tacChess.move({ from, to, promotion: prom });
    tacMoveIdx++; 
    
    tacBoardFlipped = (tacChess.turn() === 'b');
    renderTacBoard();
  } catch (e) {
    document.getElementById('tacMsg').textContent = 'Failed to load puzzle.';
  }
}

function renderTacBoard() {
  const grid = document.getElementById('tacBoardGrid');
  grid.innerHTML = '';
  
  if (tacBoardFlipped) {
    grid.style.transform = 'rotate(180deg)';
  } else {
    grid.style.transform = 'none';
  }
  
  const board = tacChess.board();
  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      const cell = document.createElement('div');
      cell.className = `board-cell ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
      const alg = String.fromCharCode(97 + c) + (8 - r);
      
      if (tacBoardFlipped) {
        cell.style.transform = 'rotate(180deg)';
      }
      
      if (tacSelectedSq === alg) {
        cell.style.backgroundColor = 'rgba(212,168,83,0.5)';
      }
      
      if (sq) {
        const img = document.createElement('img');
        img.src = PIECES[sq.color + sq.type.toUpperCase()];
        cell.appendChild(img);
      }
      
      cell.addEventListener('click', () => handleTacClick(alg, sq));
      grid.appendChild(cell);
    });
  });
}

function handleTacClick(alg, sq) {
  if (tacMoveIdx >= tacSolution.length) return; 
  
  if (!tacSelectedSq) {
    if (sq && sq.color === tacChess.turn()) {
      tacSelectedSq = alg;
      renderTacBoard();
    }
  } else {
    if (tacSelectedSq === alg) {
      tacSelectedSq = null;
      renderTacBoard();
      return;
    }
    
    const requiredMove = tacSolution[tacMoveIdx];
    const from = requiredMove.substring(0, 2);
    const to = requiredMove.substring(2, 4);
    
    if (tacSelectedSq === from && alg === to) {
      const prom = requiredMove.length > 4 ? requiredMove[4] : 'q';
      tacChess.move({ from, to, promotion: prom });
      tacSelectedSq = null;
      tacMoveIdx++;
      
      if (tacMoveIdx >= tacSolution.length) {
        document.getElementById('tacMsg').textContent = 'Puzzle Solved!';
        document.getElementById('tacMsg').style.color = '#4dc994';
        renderTacBoard();
      } else {
        document.getElementById('tacMsg').textContent = 'Correct! Keep going.';
        document.getElementById('tacMsg').style.color = '#4dc994';
        renderTacBoard();
        
        setTimeout(() => {
          const oppMove = tacSolution[tacMoveIdx];
          const of = oppMove.substring(0, 2);
          const ot = oppMove.substring(2, 4);
          const op = oppMove.length > 4 ? oppMove[4] : 'q';
          tacChess.move({ from: of, to: ot, promotion: op });
          tacMoveIdx++;
          renderTacBoard();
        }, 500);
      }
    } else {
      const grid = document.getElementById('tacBoardGrid');
      grid.style.animation = 'shake 0.4s';
      setTimeout(() => grid.style.animation = '', 400);
      tacSelectedSq = null;
      document.getElementById('tacMsg').textContent = 'Incorrect. Try again.';
      document.getElementById('tacMsg').style.color = 'var(--live-red)';
      renderTacBoard();
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   OPENING EXPLORER
═══════════════════════════════════════════════════════════ */
let expChess = new Chess();
let expSelectedSq = null;

async function initExplorer() {
  document.getElementById('expReset').addEventListener('click', () => {
    expChess = new Chess();
    expSelectedSq = null;
    fetchExplorerData();
  });
  document.getElementById('expUndo').addEventListener('click', () => {
    expChess.undo();
    expSelectedSq = null;
    fetchExplorerData();
  });
  
  fetchExplorerData();
}

async function fetchExplorerData() {
  renderExpBoard();
  const tbody = document.getElementById('expMovesTable');
  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 1rem;">Loading...</td></tr>';
  
  try {
    const fen = encodeURIComponent(expChess.fen());
    const res = await fetch(`https://explorer.lichess.ovh/masters?fen=${fen}`);
    if (!res.ok) throw new Error('API Error');
    const data = await res.json();
    
    tbody.innerHTML = '';
    
    if (data.moves.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 1rem;">No games found in Masters database.</td></tr>';
      return;
    }
    
    data.moves.slice(0, 10).forEach(m => {
      const total = m.white + m.draws + m.black;
      const wp = Math.round((m.white / total) * 100);
      const dp = Math.round((m.draws / total) * 100);
      const bp = Math.round((m.black / total) * 100);
      
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
      tr.style.cursor = 'pointer';
      tr.innerHTML = `
        <td style="padding: 0.5rem; font-weight: bold; color: var(--text-1);">${m.san}</td>
        <td style="padding: 0.5rem;">${total.toLocaleString()}</td>
        <td style="padding: 0.5rem;">
          <div style="display:flex; height: 6px; width: 100%; border-radius: 3px; overflow: hidden; background: #333;">
            <div style="width: ${wp}%; background: #fff;"></div>
            <div style="width: ${dp}%; background: #888;"></div>
            <div style="width: ${bp}%; background: #000;"></div>
          </div>
          <div style="font-size: 0.75rem; margin-top: 2px; color: var(--text-3);">${wp}% / ${dp}% / ${bp}%</div>
        </td>
      `;
      
      tr.addEventListener('click', () => {
        expChess.move(m.san);
        fetchExplorerData();
      });
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 1rem; color: var(--live-red);">Error loading data.</td></tr>';
  }
}

function renderExpBoard() {
  const grid = document.getElementById('expBoardGrid');
  grid.innerHTML = '';
  
  const board = expChess.board();
  board.forEach((row, r) => {
    row.forEach((sq, c) => {
      const cell = document.createElement('div');
      cell.className = `board-cell ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
      const alg = String.fromCharCode(97 + c) + (8 - r);
      
      if (expSelectedSq === alg) {
        cell.style.backgroundColor = 'rgba(77,201,148,0.5)';
      }
      
      if (sq) {
        const img = document.createElement('img');
        img.src = PIECES[sq.color + sq.type.toUpperCase()];
        cell.appendChild(img);
      }
      
      cell.addEventListener('click', () => {
        if (!expSelectedSq) {
          if (sq && sq.color === expChess.turn()) {
            expSelectedSq = alg;
            renderExpBoard();
          }
        } else {
          if (expSelectedSq === alg) {
            expSelectedSq = null;
            renderExpBoard();
            return;
          }
          
          const moveAttempt = expChess.move({ from: expSelectedSq, to: alg, promotion: 'q' });
          if (moveAttempt) {
            expSelectedSq = null;
            fetchExplorerData();
          } else {
            if (sq && sq.color === expChess.turn()) {
              expSelectedSq = alg;
            } else {
              expSelectedSq = null;
            }
            renderExpBoard();
          }
        }
      });
      
      grid.appendChild(cell);
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   GAMES GRID
═══════════════════════════════════════════════════════════ */
function renderGames() {
  const grid = document.getElementById('gamesGrid');
  grid.innerHTML = '';

  gamesData.forEach((g, i) => {
    const isWhite = g.white.toLowerCase() === USERNAME.toLowerCase();
    const myResult = g.result === '1/2-1/2' ? 'draw'
      : (isWhite && g.result === '1-0') || (!isWhite && g.result === '0-1') ? 'win' : 'loss';
    const resultLabel = g.result === '1/2-1/2' ? '½–½' : g.result;
    const myAcc  = isWhite ? g.accuracy.white : g.accuracy.black;
    const opp    = isWhite ? g.black : g.white;
    const dateFmt = new Date(g.date).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });

    const card = document.createElement('div');
    card.className = 'g-card reveal';
    card.style.transitionDelay = `${i * 0.06}s`;
    card.id = `gcard-${g.id}`;
    card.innerHTML = `
      <div class="g-card-top ${myResult}"></div>
      <div class="g-body">
        <div class="g-head">
          <div class="g-players">
            <div class="g-player me">
              <span class="g-player-icon">${isWhite ? '♔' : '♚'}</span>
              ${profileData.name.split(' ')[0]}
            </div>
            <div class="g-vs">vs</div>
            <div class="g-player">
              <span class="g-player-icon">${isWhite ? '♚' : '♔'}</span>
              ${opp}
            </div>
          </div>
          <span class="g-result res-${myResult}">${resultLabel}</span>
        </div>
        <div class="g-meta">
          <span class="g-tag">⏱ ${g.timeControl}</span>
          <span class="g-tag">📅 ${dateFmt}</span>
          <span class="g-tag">🏁 ${g.moves} moves</span>
        </div>
        <div class="acc-bar-wrap">
          <div class="acc-labels"><span>My Accuracy</span><span>${myAcc}%</span></div>
          <div class="acc-bar"><div class="acc-fill" style="width:${myAcc}%"></div></div>
        </div>
      </div>
      <div class="g-footer">
        <span class="g-opening">${g.opening}</span>
        <button class="g-replay-btn" data-id="${g.id}">▶ Replay</button>
      </div>
    `;
    card.addEventListener('click', () => loadReplay(g));
    grid.appendChild(card);
  });
}

/* ═══════════════════════════════════════════════════════════
   BOARD REPLAY
═══════════════════════════════════════════════════════════ */
function initReplayBoard() {
  renderRepBoard(new Chess(), null);
  document.getElementById('repFirst').addEventListener('click', () => goTo(0));
  document.getElementById('repPrev').addEventListener('click',  () => goTo(repMoveIdx - 1));
  document.getElementById('repNext').addEventListener('click',  () => goTo(repMoveIdx + 1));
  document.getElementById('repLast').addEventListener('click',  () => goTo(repHistory.length - 1));
  document.getElementById('repPlay').addEventListener('click',  toggleAutoPlay);
}

function loadReplay(game) {
  document.getElementById('replay').scrollIntoView({ behavior: 'smooth', block: 'start' });
  stopAutoPlay();
  repGame = game;

  // Parse PGN
  const tempChess = new Chess();
  tempChess.load_pgn(game.pgn);
  repHistory = tempChess.history({ verbose: true });
  repChess   = new Chess();
  repMoveIdx = -1;

  const isW = game.white.toLowerCase() === USERNAME.toLowerCase();
  const rLabel = game.result === '1/2-1/2' ? 'Draw'
    : (isW && game.result === '1-0') || (!isW && game.result === '0-1') ? 'Win' : 'Loss';

  document.getElementById('repInfo').innerHTML = `
    <p class="rep-title">${game.white} <span style="color:var(--text-3)">vs</span> ${game.black}</p>
    <p class="rep-sub">${game.timeControl} · ${game.opening} · ${rLabel} · ${game.moves} moves</p>
  `;

  buildMoveList();
  renderRepBoard(repChess, null);
  updateProgress();
}

function goTo(idx) {
  if (!repHistory.length) return;
  const target = Math.max(-1, Math.min(idx, repHistory.length - 1));
  
  if (target >= 0 && target > repMoveIdx) {
    const lastMove = repHistory[target];
    const isCapture = lastMove.flags.includes('c') || lastMove.flags.includes('e');
    const snd = document.getElementById(isCapture ? 'sndCapture' : 'sndMove');
    if (snd) { snd.currentTime = 0; snd.play().catch(()=>{}); }
  }
  
  repChess = new Chess();
  for (let i = 0; i <= target; i++) repChess.move(repHistory[i]);
  repMoveIdx = target;
  renderRepBoard(repChess, target >= 0 ? repHistory[target] : null);
  updateProgress();
  highlightMove();
  
  // Replay Engine Analysis
  clearTimeout(repEvalTimer);
  document.getElementById('repEngineAnalysis').style.display = 'block';
  document.getElementById('repEngineLoading').style.display = 'inline';
  document.getElementById('repEngineText').innerHTML = '';
  
  repEvalTimer = setTimeout(() => {
    fetchRepEval(repChess.fen());
  }, 500);
}

async function fetchRepEval(fen) {
  try {
    let res = await fetch('https://chess-api.com/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, depth: 11, maxMoves: 1 })
    });
    let data = await res.json();
    
    if (data && data.error === 'INVALID_FEN_VALIDATION_ERROR') {
      const safeFen = fen.replace(/ [a-h][36] /, ' - ');
      res = await fetch('https://chess-api.com/v1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: safeFen, depth: 11, maxMoves: 1 })
      });
      data = await res.json();
    }

    document.getElementById('repEngineLoading').style.display = 'none';
    if (data && !data.error && data.text) {
      let cp = data.centipawns != null ? data.centipawns : (data.mate != null ? (data.mate > 0 ? 9999 : -9999) : 0);
      const evalClass = cp > 30 ? 'pos' : cp < -30 ? 'neg' : 'eq';
      let evalStr = data.mate != null ? `M${Math.abs(data.mate)}` : `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
      
      document.getElementById('repEngineText').innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.5rem; padding-top: 0.5rem;">
          <strong style="color:var(--text-1); font-size:1.05rem;">${data.san || data.move}</strong>
          <span class="bm-eval ${evalClass}">${evalStr}</span>
        </div>
        ${data.text}
      `;
    } else {
      document.getElementById('repEngineText').textContent = 'Analysis unavailable.';
    }
  } catch(e) {
    document.getElementById('repEngineLoading').style.display = 'none';
    document.getElementById('repEngineText').textContent = 'API Error.';
  }
}

function renderRepBoard(chessInst, lastMove) {
  const grid = document.getElementById('repBoardGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const boardMap = {};
  chessInst.board().forEach((row, ri) => {
    row.forEach((p, fi) => { if (p) boardMap[`${fi},${ri}`] = p; });
  });

  const lastSqs = new Set();
  if (lastMove) {
    lastSqs.add(sqToCoord(lastMove.from));
    lastSqs.add(sqToCoord(lastMove.to));
  }

  const isWhite = repGame && repGame.white.toLowerCase() === USERNAME.toLowerCase();
  const flip = !isWhite;
  const ranks = flip ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const files = flip ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];

  for (let rank of ranks) {
    for (let file of files) {
      const cell = document.createElement('div');
      cell.className = `rep-cell ${(rank + file) % 2 === 0 ? 'light' : 'dark'}`;
      const coord = `${file},${rank}`;
      if (lastSqs.has(coord)) cell.classList.add('hi-last');
      const p = boardMap[coord];
      if (p) {
        const url = PIECES[`${p.color}${p.type.toUpperCase()}`];
        if (url) cell.innerHTML = `<img src="${url}" alt="piece" style="width:85%;height:85%;pointer-events:none;">`;
      }
      grid.appendChild(cell);
    }
  }
}

function buildMoveList() {
  const list = document.getElementById('moveList');
  list.innerHTML = '';
  for (let i = 0; i < repHistory.length; i += 2) {
    const pair = document.createElement('div');
    pair.className = 'move-pair';

    const num = document.createElement('span');
    num.className = 'move-num';
    num.textContent = `${Math.floor(i / 2) + 1}.`;

    const w = document.createElement('span');
    w.className = 'move-tok';
    w.textContent = repHistory[i].san;
    w.dataset.mi = i;
    w.addEventListener('click', () => goTo(i));
    pair.append(num, w);

    if (repHistory[i + 1]) {
      const b = document.createElement('span');
      b.className = 'move-tok';
      b.textContent = repHistory[i + 1].san;
      b.dataset.mi = i + 1;
      b.addEventListener('click', () => goTo(i + 1));
      pair.appendChild(b);
    }
    list.appendChild(pair);
  }
}

function updateProgress() {
  const total = repHistory.length;
  const curr  = repMoveIdx + 1;
  const pct   = total > 0 ? (curr / total) * 100 : 0;
  document.getElementById('repProg').style.width = `${pct}%`;
  document.getElementById('repMoveLbl').textContent = `Move ${curr} / ${total}`;
}

function highlightMove() {
  document.querySelectorAll('.move-tok').forEach(el => {
    el.classList.remove('active');
    if (parseInt(el.dataset.mi) === repMoveIdx) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest' });
    }
  });
}

function toggleAutoPlay() {
  const btn = document.getElementById('repPlay');
  if (repAutoTimer) {
    stopAutoPlay();
  } else {
    btn.classList.add('playing');
    btn.textContent = '⏸';
    repAutoTimer = setInterval(() => {
      if (repMoveIdx >= repHistory.length - 1) { stopAutoPlay(); return; }
      goTo(repMoveIdx + 1);
    }, 700);
  }
}

function stopAutoPlay() {
  clearInterval(repAutoTimer);
  repAutoTimer = null;
  const btn = document.getElementById('repPlay');
  if (btn) { btn.classList.remove('playing'); btn.textContent = '▶'; }
}

/* ═══════════════════════════════════════════════════════════
   OPENINGS
═══════════════════════════════════════════════════════════ */
function renderOpenings() {
  const openings = profileData.openings;

  // Stacked bar chart
  const ctx = document.getElementById('openingsChart').getContext('2d');
  openingsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: openings.map(o => o.name),
      datasets: [
        { label:'Wins',   data:openings.map(o=>o.wins),   backgroundColor:'rgba(77,201,148,0.75)',  borderRadius:3 },
        { label:'Draws',  data:openings.map(o=>o.draws),  backgroundColor:'rgba(232,192,106,0.75)', borderRadius:3 },
        { label:'Losses', data:openings.map(o=>o.losses), backgroundColor:'rgba(224,92,107,0.75)',  borderRadius:3 }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color:'#8A8EA8', boxWidth:10, font:{ size:11 } } },
        tooltip: {
          backgroundColor:'#0F101C', borderColor:'rgba(212,168,83,0.25)', borderWidth:1,
          titleColor:'#D4A853', bodyColor:'#EEF0F8', padding:12
        }
      },
      scales: {
        x: { stacked:true, grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#50546A',font:{size:10}} },
        y: { stacked:true, grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#8A8EA8',font:{size:10}} }
      }
    }
  });

  // Opening list
  const list = document.getElementById('openingList');
  list.innerHTML = '';
  openings.forEach(o => {
    const total = o.wins + o.draws + o.losses;
    const wP = ((o.wins  / total) * 100).toFixed(0);
    const dP = ((o.draws / total) * 100).toFixed(0);
    const lP = ((o.losses/ total) * 100).toFixed(0);
    const item = document.createElement('div');
    item.className = 'op-item reveal';
    item.innerHTML = `
      <div class="op-head">
        <span class="op-name">${o.name}</span>
        <span class="op-games">${total} games</span>
      </div>
      <div class="op-bar">
        <div class="op-w" style="flex:${o.wins}"></div>
        <div class="op-d" style="flex:${o.draws}"></div>
        <div class="op-l" style="flex:${o.losses}"></div>
      </div>
      <div class="op-pcts">
        <span class="op-pct-w">W ${wP}%</span>
        <span class="op-pct-d">D ${dP}%</span>
        <span class="op-pct-l">L ${lP}%</span>
      </div>
    `;
    list.appendChild(item);
  });
}

/* ═══════════════════════════════════════════════════════════
   STATISTICS
═══════════════════════════════════════════════════════════ */
function renderStats() {
  const s = profileData.stats;
  const cards = [
    { icon:'✅', val: s.wins.toLocaleString(),    lbl:'Total Wins'    },
    { icon:'❌', val: s.losses.toLocaleString(),  lbl:'Total Losses'  },
    { icon:'🤝', val: s.draws.toLocaleString(),   lbl:'Draws'         },
    { icon:'⭐', val: profileData.fideRating,     lbl:'FIDE Rating'   },
    { icon:'🧩', val: profileData.ratings.puzzle, lbl:'Puzzle Rating' },
    { icon:'📈', val: s.bestRating,               lbl:'Peak Lichess'  }
  ];

  const grid = document.getElementById('statsCards');
  grid.innerHTML = '';
  cards.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'sc reveal';
    el.style.transitionDelay = `${i * 0.06}s`;
    el.innerHTML = `<div class="sc-icon">${c.icon}</div><div class="sc-val">${c.val}</div><div class="sc-lbl">${c.lbl}</div>`;
    grid.appendChild(el);
  });

  // WDL bar — animate after a short delay
  const total = s.wins + s.draws + s.losses;
  setTimeout(() => {
    document.getElementById('wdlW').style.width = `${(s.wins   / total * 100).toFixed(1)}%`;
    document.getElementById('wdlD').style.width = `${(s.draws  / total * 100).toFixed(1)}%`;
    document.getElementById('wdlL').style.width = `${(s.losses / total * 100).toFixed(1)}%`;
    document.getElementById('wdlWLbl').textContent = `${(s.wins   / total * 100).toFixed(0)}%`;
    document.getElementById('wdlDLbl').textContent = `${(s.draws  / total * 100).toFixed(0)}%`;
    document.getElementById('wdlLLbl').textContent = `${(s.losses / total * 100).toFixed(0)}%`;
    document.getElementById('wdlWN').textContent   = s.wins.toLocaleString();
    document.getElementById('wdlDN').textContent   = s.draws.toLocaleString();
    document.getElementById('wdlLN').textContent   = s.losses.toLocaleString();
  }, 800);
}

/* ═══════════════════════════════════════════════════════════
   ACHIEVEMENTS
═══════════════════════════════════════════════════════════ */
function renderAchievements() {
  const grid = document.getElementById('achGrid');
  grid.innerHTML = '';
  profileData.achievements.forEach((a, i) => {
    const el = document.createElement('div');
    el.className = `ach-card ${a.unlocked ? 'unlocked' : 'locked'} reveal`;
    el.style.transitionDelay = `${i * 0.06}s`;
    el.id = `ach-${a.id}`;
    el.innerHTML = `
      <div class="ach-shine"></div>
      <div class="ach-icon-wrap">${a.icon}</div>
      <div class="ach-name">${a.title}</div>
      <div class="ach-desc">${a.desc}</div>
      <span class="ach-badge">${a.unlocked ? '✓ Unlocked' : '🔒 Locked'}</span>
    `;
    grid.appendChild(el);
  });
}

/* ═══════════════════════════════════════════════════════════
   SCROLL REVEAL
═══════════════════════════════════════════════════════════ */
function initScrollReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

  setTimeout(() => {
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  }, 50);
}

/* ═══════════════════════════════════════════════════════════
   MISC
═══════════════════════════════════════════════════════════ */
function setFooterDate() {
  const el = document.getElementById('footerDate');
  if (el) el.textContent = `Last updated: ${new Date().toLocaleString('en-US', {
    month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'
  })}`;
}

/* ═══════════════════════════════════════════════════════════
   EMBEDDED DATA (fallback when fetch() blocked on file://)
═══════════════════════════════════════════════════════════ */
const PROFILE = {
  username: 'clifford10', name: 'Clifford Jose',
  fullName: 'Clifford Jose Nediyaparambil',
  fideRating: 2000,
  location: 'Trivandrum, Kerala, India',
  bio: 'Software developer & chess player from Kerala, India. FIDE rated 2000.',
  ratings: { rapid:1547, blitz:1083, bullet:1011, classical:1355, puzzle:1568 },
  stats: { gamesPlayed:991, wins:454, losses:495, draws:42, winRate:45.8,
           avgAccuracy:0, longestWinStreak:0, currentStreak:0, bestRating:1577 },
  achievements: [
    { id:1, icon:'🥇', title:'FIDE Rated 2000',     desc:'Holds an official FIDE rating of 2000',        unlocked:true  },
    { id:2, icon:'🎯', title:'900+ Games Played',   desc:'Completed 991 rated Lichess games',             unlocked:true  },
    { id:3, icon:'🧩', title:'Puzzle Champion',     desc:'Puzzle rating of 1568 on Lichess',              unlocked:true  },
    { id:4, icon:'⚡', title:'Rapid Peak 1577',     desc:'Achieved highest Rapid rating of 1577',         unlocked:true  },
    { id:5, icon:'🌟', title:'Blitz 1100+',         desc:'Reached 1100+ in Blitz time control',           unlocked:true  },
    { id:6, icon:'🌍', title:'Indian Flag 🇮🇳',    desc:'Representing Kerala, India on Lichess',         unlocked:true  },
    { id:7, icon:'🏆', title:'Tournament Winner',   desc:'Win a Lichess arena tournament',                unlocked:false },
    { id:8, icon:'👑', title:'Crossed 1600 Rapid',  desc:'Reach 1600+ in Rapid time control',            unlocked:false }
  ],
  openings: [
    { name:'Sicilian Defense',    games:87,  wins:42, losses:34, draws:11, color:'#4DC994' },
    { name:'French Defense',      games:54,  wins:21, losses:25, draws:8,  color:'#D4A853' },
    { name:"King's Pawn Opening", games:43,  wins:18, losses:20, draws:5,  color:'#4A90D9' },
    { name:"Queen's Gambit",      games:38,  wins:17, losses:16, draws:5,  color:'#E05C6B' },
    { name:'London System',       games:31,  wins:14, losses:14, draws:3,  color:'#9B59B6' }
  ],
  ratingHistory: {
    bullet:    [{date:'2024-04',rating:700},{date:'2024-06',rating:693},{date:'2024-08',rating:751},{date:'2024-12',rating:810},{date:'2026-01',rating:1104},{date:'2026-02',rating:1083},{date:'2026-03',rating:1074},{date:'2026-04',rating:1052},{date:'2026-05',rating:1076},{date:'2026-06',rating:1081},{date:'2026-07',rating:1044},{date:'2026-08',rating:1011}],
    blitz:     [{date:'2024-04',rating:766},{date:'2024-05',rating:813},{date:'2024-06',rating:868},{date:'2024-07',rating:910},{date:'2024-08',rating:931},{date:'2026-01',rating:1063},{date:'2026-02',rating:1104},{date:'2026-03',rating:1079},{date:'2026-06',rating:1082},{date:'2026-07',rating:1132},{date:'2026-08',rating:1083}],
    rapid:     [{date:'2024-05',rating:1577},{date:'2024-06',rating:1408},{date:'2026-01',rating:1528},{date:'2026-02',rating:1451},{date:'2026-07',rating:1464},{date:'2026-07',rating:1492},{date:'2026-08',rating:1547}],
    classical: [{date:'2024-03',rating:1276},{date:'2024-04',rating:1105},{date:'2026-01',rating:1231},{date:'2026-02',rating:1299},{date:'2026-03',rating:1355}]
  }
};

const GAMES = [
  { id:'g1', white:'clifford10', black:'DragonSlayer99', result:'1-0', timeControl:'Rapid',
    accuracy:{white:94,black:82}, opening:'Sicilian Defense', date:'2024-12-28', moves:42,
    pgn:'1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5 7. Nb3 Be7 8. O-O O-O 9. Be3 Be6 10. Nd5 Nbd7 11. Nxe7+ Qxe7 12. Nd2 b5 13. a3 Nb6 14. f3 Nfd7 15. c4 bxc4 16. Nxc4 Nxc4 17. Bxc4 Bxc4 18. Rxc4 Nb6 19. Rc2 Qd7 20. Qd3 Rfc8 21. Rfc1 Rxc2 22. Rxc2 Rc8 23. Rxc8+ Qxc8 24. Qc2 Qxc2 25. Bxb6 Qc6 26. Be3 f6 27. b4 Kf7 28. Kf2 Ke6 29. Ke2 Kd7 30. Kd3 Kc8 31. Kc4 Kb7 32. b5 axb5+ 33. Kxb5 Qc2 34. a4 Qb1+ 35. Ka5 Qc2 36. a5 Qc7+ 37. Ka6 Qc8+ 38. Ka7 Qa8+ 39. Kb6 Qb8+ 40. Kc5 Qc7+ 41. Kd5 Qd8+ 42. Ke6 1-0' },
  { id:'g2', white:'KnightRider2000', black:'clifford10', result:'0-1', timeControl:'Blitz',
    accuracy:{white:78,black:93}, opening:'London System', date:'2024-12-27', moves:38,
    pgn:'1. d4 d5 2. Bf4 Nf6 3. e3 e6 4. Nf3 c5 5. c3 Nc6 6. Nbd2 Bd6 7. Bg3 O-O 8. Bd3 b6 9. Ne5 Bb7 10. f4 Ne7 11. Qf3 Nf5 12. Bxf5 exf5 13. Ndf3 c4 14. O-O Ne4 15. Bh4 g6 16. Ng5 Nxg5 17. fxg5 f4 18. exf4 Rxf4 19. Qe2 Qxg5 20. Bxg5 Rxg4 21. Bh6 Rg2+ 22. Kh1 Rxe2 23. Rxf8+ Kxf8 24. Nxe2 Bc6 25. Nf4 Bxf4 26. Bxf4 Ke7 27. h4 Kf6 28. Bg5+ Ke5 29. Bf4+ Kxf4 30. Kg1 Ke3 31. Kf1 Kd2 32. b3 cxb3 33. axb3 Kc3 34. b4 a5 35. bxa5 bxa5 36. c4 dxc4 37. Ke2 c3 38. Kd1 Bd5 0-1' },
  { id:'g3', white:'clifford10', black:'PawnStorm99', result:'1-0', timeControl:'Rapid',
    accuracy:{white:91,black:85}, opening:'Ruy Lopez', date:'2024-12-26', moves:35,
    pgn:'1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 12. Bc2 Re8 13. Nf1 Bf8 14. Ng3 g6 15. a4 c5 16. d5 c4 17. Bg5 h6 18. Be3 Nc5 19. Nd2 Nfd7 20. axb5 axb5 21. Rxa8 Bxa8 22. Ndf1 Nb6 23. Ne2 Qd7 24. Ng3 Na4 25. Bxa4 bxa4 26. b3 cxb3 27. cxb3 a3 28. Qd2 Bg7 29. Rc1 Rc8 30. Rxc8+ Qxc8 31. Nf5 gxf5 32. exf5 Nd7 33. f6 Bxf6 34. Bxh6 Bg7 35. Bxg7 1-0' },
  { id:'g4', white:'TacticalGenius', black:'clifford10', result:'1/2-1/2', timeControl:'Classical',
    accuracy:{white:90,black:92}, opening:"King's Indian Defense", date:'2024-12-25', moves:44,
    pgn:"1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O 6. Be2 e5 7. O-O Nc6 8. d5 Ne7 9. Ne1 Nd7 10. f3 f5 11. g4 fxg4 12. fxg4 Nf6 13. g5 Nh5 14. Ng2 Nf4 15. Nxf4 exf4 16. Rxf4 Ne5 17. Rxf8+ Kxf8 18. Bd3 Nxd3 19. Qxd3 c6 20. Bg5 Qa5 21. Ne2 cxd5 22. cxd5 Bf5 23. exf5 Qxg5 24. fxg6 hxg6 25. Nf4 Qxg5+ 26. Ng2 Qxd5 27. Qxd5 Bxd4+ 28. Kg2 b6 29. Rd1 Bc5 30. Rxd6 Ke7 31. Rd5 Bd4 32. h4 Rc8 33. h5 Rc2 34. hxg6 Rxg2+ 35. Kf1 Rg4 36. Rd7+ Ke6 37. Rxg7 Rxg6 38. Rxg6+ Kxg6 39. b3 Kh5 40. Ke2 Bc5 41. Kd3 b5 42. Kc4 a5 43. Kb5 a4 44. bxa4 1/2-1/2" },
  { id:'g5', white:'clifford10', black:'EndgameMaster', result:'1-0', timeControl:'Blitz',
    accuracy:{white:90,black:84}, opening:'Caro-Kann Defense', date:'2024-12-24', moves:31,
    pgn:'1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7 8. h5 Bh7 9. Bd3 Bxd3 10. Qxd3 Ngf6 11. Bd2 e6 12. O-O-O Be7 13. Ne4 Nxe4 14. Qxe4 Nf6 15. Qe2 Qd5 16. c4 Qe4 17. Qxe4 Nxe4 18. Be3 Bf6 19. Nd2 Nxd2 20. Rxd2 O-O-O 21. f4 c5 22. d5 exd5 23. cxd5 c4 24. d6 Rxd6 25. Rxd6 Bxd6 26. Rd1 Be7 27. Rxd8+ Kxd8 28. Kd2 Kd7 29. Kc3 Bc5 30. Bxc5 b6 31. Bd4 1-0' }
];
