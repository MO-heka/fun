// ============================================================
// SPORCEL PARTY - Main Game Logic
// ============================================================

'use strict';

// ============================================================
// CONSTANTS & CONFIG
// ============================================================
const AVATARS = ['🦁', '🐯', '🦊', '🐻', '🐼', '🦅', '🦋', '🐬', '🦄', '🐲', '🤖', '👾', '🎭', '🎸', '🚀', '💎', '🌟', '🔥', '⚡', '🌈'];
const AVATAR_COLORS = [
  'linear-gradient(135deg,#7c3aed,#ec4899)',
  'linear-gradient(135deg,#06b6d4,#7c3aed)',
  'linear-gradient(135deg,#f59e0b,#ec4899)',
  'linear-gradient(135deg,#10b981,#06b6d4)',
  'linear-gradient(135deg,#ef4444,#f59e0b)',
  'linear-gradient(135deg,#8b5cf6,#10b981)',
];

const DIFFICULTY_LABELS = { easy: 'سهل', medium: 'متوسط', hard: 'صعب' };
const FINAL_ROUND_POINTS = [0, 10, 20];
const FINAL_ROUND_DIFFICULTIES = ['easy', 'medium', 'hard'];

// ============================================================
// GAME STATE (local)
// ============================================================
let gState = {
  // Room
  roomCode: null,
  isHost: false,

  // Player
  playerId: null,
  playerName: null,
  playerAvatar: null,
  playerAvatarColor: null,

  // Game settings
  settings: {
    rounds: 10,
    timePerQuestion: 30,
    categories: ['general']
  },

  // Game data
  questions: [],
  currentRound: 0,
  totalRounds: 0,

  // Round state
  timerInterval: null,
  timeLeft: 0,
  maxTime: 30,
  selectedWager: null,
  usedWagers: [],
  hasSubmitted: false,
  phase: 'waiting', // waiting | lobby | playing | results | voting | final | winner

  // Listeners
  roomListener: null
};

// ============================================================
// AUDIO ENGINE (Web Audio API)
// ============================================================
const AudioEngine = (() => {
  let ctx = null;

  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  }

  function beep(freq = 440, type = 'sine', dur = 0.2, vol = 0.3) {
    try {
      ensureCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + dur);
    } catch(e) {}
  }

  return {
    correct() {
      beep(520, 'sine', 0.15, 0.3);
      setTimeout(() => beep(660, 'sine', 0.2, 0.3), 150);
      setTimeout(() => beep(880, 'sine', 0.3, 0.3), 300);
    },
    wrong() {
      beep(280, 'sawtooth', 0.3, 0.3);
      setTimeout(() => beep(220, 'sawtooth', 0.3, 0.3), 200);
    },
    tick() {
      beep(800, 'square', 0.05, 0.1);
    },
    urgentTick() {
      beep(1200, 'square', 0.08, 0.15);
    },
    start() {
      [0, 150, 300, 450, 600].forEach((d, i) => {
        setTimeout(() => beep(440 + i * 110, 'sine', 0.12, 0.25), d);
      });
    },
    win() {
      const melody = [523, 659, 784, 1047];
      melody.forEach((f, i) => setTimeout(() => beep(f, 'sine', 0.3, 0.4), i * 200));
    },
    newRound() {
      beep(440, 'triangle', 0.1, 0.2);
      setTimeout(() => beep(660, 'triangle', 0.15, 0.2), 120);
    }
  };
})();

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function generatePlayerId() {
  return 'P' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

function normalizeAnswer(str) {
  return str.toLowerCase().trim()
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ');
}

function checkAnswer(userAnswer, correctAnswers) {
  const norm = normalizeAnswer(userAnswer);
  return correctAnswers.some(a => normalizeAnswer(a) === norm ||
    normalizeAnswer(a).includes(norm) ||
    norm.includes(normalizeAnswer(a)));
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuestionSet(settings) {
  const all = [];
  const cats = settings.categories || ['general'];

  cats.forEach(catId => {
    const cat = window.CATEGORIES?.[catId];
    if (!cat) return;

    // Filter by difficulty if needed (or use all)
    const qs = cat.questions.map(q => ({ ...q, category: catId, categoryName: cat.name, categoryIcon: cat.icon, categoryColor: cat.color }));
    all.push(...qs);
  });

  const shuffled = shuffleArray(all);
  return shuffled.slice(0, settings.rounds);
}

function el(id) { return document.getElementById(id); }

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(msg, type = 'info', duration = 3000) {
  const container = el('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✅', error: '❌', info: '💡', warning: '⚠️' };
  toast.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.4s ease forwards';
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ============================================================
// CONFETTI
// ============================================================
function launchConfetti(count = 60) {
  const colors = ['#7c3aed', '#ec4899', '#06b6d4', '#f59e0b', '#10b981', '#fff'];
  const container = document.body;

  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.cssText = `
        left: ${Math.random() * 100}vw;
        top: -20px;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        width: ${6 + Math.random() * 8}px;
        height: ${6 + Math.random() * 8}px;
        border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
        animation-duration: ${2 + Math.random() * 2}s;
        animation-delay: ${Math.random() * 0.5}s;
      `;
      container.appendChild(piece);
      setTimeout(() => piece.remove(), 4000);
    }, i * 30);
  }
}

// ============================================================
// SCORE POP ANIMATION
// ============================================================
function showScorePop(points, x, y) {
  const pop = document.createElement('div');
  pop.className = `score-pop ${points >= 0 ? 'positive' : 'negative'}`;
  pop.textContent = points >= 0 ? `+${points}` : `${points}`;
  pop.style.left = (x || window.innerWidth / 2) + 'px';
  pop.style.top  = (y || window.innerHeight / 2) + 'px';
  document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 1600);
}

// ============================================================
// PAGE NAVIGATION
// ============================================================
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = el('page-' + pageId);
  if (target) target.classList.add('active');
  window.scrollTo(0, 0);
}

// ============================================================
// FLOATING PARTICLES
// ============================================================
function initParticles() {
  const container = el('particles');
  if (!container) return;
  const colors = ['#7c3aed', '#ec4899', '#06b6d4', '#f59e0b', '#10b981'];

  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 2 + Math.random() * 4;
    p.style.cssText = `
      width: ${size}px; height: ${size}px;
      left: ${Math.random() * 100}vw;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      animation-duration: ${8 + Math.random() * 12}s;
      animation-delay: ${Math.random() * 8}s;
    `;
    container.appendChild(p);
  }
}

// ============================================================
// HOME PAGE
// ============================================================
function initHome() {
  el('btn-create-room').onclick = () => showModal('modal-create');
  el('btn-join-room').onclick = () => showModal('modal-join');
  el('btn-how-to-play').onclick = () => showModal('modal-how');
}

// ============================================================
// MODALS
// ============================================================
function showModal(id) {
  el(id).classList.remove('hidden');
}

function hideModal(id) {
  el(id).classList.add('hidden');
}

function initModals() {
  // Close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // Close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.onclick = () => btn.closest('.modal-overlay').classList.add('hidden');
  });

  // Create room form
  el('form-create').onsubmit = async (e) => {
    e.preventDefault();
    const name = el('input-create-name').value.trim();
    if (!name) { showToast('أدخل اسمك أولاً', 'warning'); return; }
    hideModal('modal-create');
    await createRoom(name);
  };

  // Join room form
  el('form-join').onsubmit = async (e) => {
    e.preventDefault();
    const name = el('input-join-name').value.trim();
    const code = el('input-join-code').value.trim().toUpperCase();
    if (!name) { showToast('أدخل اسمك أولاً', 'warning'); return; }
    if (!code || code.length < 4) { showToast('أدخل كود الغرفة', 'warning'); return; }
    hideModal('modal-join');
    await joinRoom(name, code);
  };
}

// ============================================================
// CREATE ROOM
// ============================================================
async function createRoom(playerName) {
  if (!window.firebaseManager?.initialized) {
    showToast('Firebase غير متصل — تأكد من الإعداد', 'error');
    return;
  }

  const fm = window.firebaseManager;
  const playerId = generatePlayerId();
  const avatarIdx = Math.floor(Math.random() * AVATARS.length);
  const colorIdx  = Math.floor(Math.random() * AVATAR_COLORS.length);

  gState.playerId = playerId;
  gState.playerName = playerName;
  gState.playerAvatar = AVATARS[avatarIdx];
  gState.playerAvatarColor = AVATAR_COLORS[colorIdx];
  gState.isHost = true;

  // Generate unique room code
  let code = fm.generateRoomCode();
  let attempts = 0;
  while (attempts < 5) {
    const existing = await fm.getRoom(code);
    if (!existing) break;
    code = fm.generateRoomCode();
    attempts++;
  }

  gState.roomCode = code;

  const roomData = {
    code,
    hostId: playerId,
    status: 'lobby',
    createdAt: Date.now(),
    settings: { rounds: 10, timePerQuestion: 30, categories: ['general'] },
    players: {
      [playerId]: {
        id: playerId,
        name: playerName,
        avatar: AVATARS[avatarIdx],
        avatarColor: AVATAR_COLORS[colorIdx],
        score: 0,
        usedWagers: [],
        joinedAt: Date.now()
      }
    },
    game: null
  };

  const ok = await fm.writeRoom(code, roomData);
  if (!ok) { showToast('خطأ في إنشاء الغرفة', 'error'); return; }

  showToast(`تم إنشاء الغرفة 🎉`, 'success');
  showLobby(roomData);
  listenToRoom();
}

// ============================================================
// JOIN ROOM
// ============================================================
async function joinRoom(playerName, code) {
  if (!window.firebaseManager?.initialized) {
    showToast('Firebase غير متصل', 'error');
    return;
  }

  const fm = window.firebaseManager;

  const roomData = await fm.getRoom(code);
  if (!roomData) { showToast('الغرفة غير موجودة', 'error'); return; }
  if (roomData.status === 'playing' || roomData.status === 'final') {
    showToast('اللعبة بدأت بالفعل', 'warning'); return;
  }

  const players = roomData.players || {};
  const count = Object.keys(players).length;
  if (count >= 20) { showToast('الغرفة ممتلئة (20 لاعب)', 'warning'); return; }

  const playerId = generatePlayerId();
  const avatarIdx = Math.floor(Math.random() * AVATARS.length);
  const colorIdx  = Math.floor(Math.random() * AVATAR_COLORS.length);

  gState.playerId = playerId;
  gState.playerName = playerName;
  gState.playerAvatar = AVATARS[avatarIdx];
  gState.playerAvatarColor = AVATAR_COLORS[colorIdx];
  gState.isHost = false;
  gState.roomCode = code;

  const playerData = {
    id: playerId,
    name: playerName,
    avatar: AVATARS[avatarIdx],
    avatarColor: AVATAR_COLORS[colorIdx],
    score: 0,
    usedWagers: [],
    joinedAt: Date.now()
  };

  const ok = await fm.setPath(`rooms/${code}/players/${playerId}`, playerData);
  if (!ok) { showToast('فشل الانضمام للغرفة', 'error'); return; }

  showToast(`انضممت للغرفة ${code} 🎉`, 'success');
  showLobby(roomData);
  listenToRoom();
}

// ============================================================
// LISTEN TO ROOM (real-time)
// ============================================================
function listenToRoom() {
  const fm = window.firebaseManager;

  // Detach previous
  if (gState.roomListener) {
    fm.detachAllListeners();
  }

  gState.roomListener = fm.listenToRoom(gState.roomCode, (roomData) => {
    if (!roomData) return;

    // Update lobby
    if (gState.phase === 'lobby') {
      updateLobbyUI(roomData);
    }

    // --- Phase transitions ---
    const status = roomData.status;
    const game   = roomData.game;

    // Start playing
    if (status === 'playing' && gState.phase !== 'playing' && gState.phase !== 'results') {
      gState.phase = 'playing';
      startGamePhase(roomData);
    }

    // Show results
    if (status === 'results' && gState.phase === 'playing') {
      gState.phase = 'results';
      showResultsPhase(roomData);
    }

    // Next round / continue
    if (status === 'next_round' && gState.phase === 'results') {
      gState.phase = 'playing';
      startGamePhase(roomData);
    }

    // Voting phase
    if (status === 'voting' && gState.phase !== 'voting') {
      gState.phase = 'voting';
      showVotingPhase(roomData);
    }

    // Final round
    if (status === 'final' && gState.phase !== 'final') {
      gState.phase = 'final';
      startFinalRound(roomData);
    }

    // Final results
    if (status === 'final_results' && gState.phase === 'final') {
      gState.phase = 'final_results';
      showFinalResults(roomData);
    }

    // Winner
    if (status === 'winner' && gState.phase !== 'winner') {
      gState.phase = 'winner';
      showWinnerScreen(roomData);
    }

    // Live updates within playing phase
    if (status === 'playing' && gState.phase === 'playing') {
      updatePlayingUI(roomData);
    }

    // Live updates within results phase
    if (status === 'results' && gState.phase === 'results') {
      updateResultsMarking(roomData);
    }

    // Live updates within voting phase
    if (status === 'voting' || status === 'voting_results') {
      if (gState.phase === 'voting') updateVotingUI(roomData);
    }
  });
}

// ============================================================
// LOBBY UI
// ============================================================
function showLobby(roomData) {
  gState.phase = 'lobby';
  showPage('lobby');

  // Room code display
  el('lobby-room-code').textContent = gState.roomCode;
  el('lobby-room-code').onclick = () => {
    navigator.clipboard.writeText(gState.roomCode).then(() => showToast('تم نسخ الكود 📋', 'success'));
  };

  // Host controls
  if (gState.isHost) {
    el('host-controls').classList.remove('hidden');
    el('non-host-msg').classList.add('hidden');
    initHostSettings(roomData.settings);
  } else {
    el('host-controls').classList.add('hidden');
    el('non-host-msg').classList.remove('hidden');
  }

  el('btn-start-game').onclick = () => startGame();

  updateLobbyUI(roomData);
}

function updateLobbyUI(roomData) {
  const players = roomData.players || {};
  const playerList = Object.values(players).sort((a, b) => a.joinedAt - b.joinedAt);

  const grid = el('players-grid');
  grid.innerHTML = '';

  playerList.forEach(p => {
    const isMe   = p.id === gState.playerId;
    const isHost = p.id === roomData.hostId;
    const slot = document.createElement('div');
    slot.className = `player-slot filled ${isMe ? 'me' : ''} ${isHost ? 'host-slot' : ''}`;
    slot.innerHTML = `
      ${isHost ? '<div class="host-badge">👑 مشرف</div>' : ''}
      <div class="player-avatar" style="background: ${p.avatarColor}">${p.avatar}</div>
      <div class="player-name">${escHtml(p.name)}</div>
      <div class="player-status">${isMe ? '(أنت)' : '✓ جاهز'}</div>
    `;
    grid.appendChild(slot);
  });

  // Player count
  el('lobby-player-count').textContent = `${playerList.length} لاعب`;

  // Update settings display if not host
  if (!gState.isHost && roomData.settings) {
    updateSettingsDisplay(roomData.settings);
  }
}

function initHostSettings(settings) {
  // Rounds slider
  const roundsSlider = el('setting-rounds');
  const roundsVal = el('setting-rounds-val');
  roundsSlider.value = settings.rounds;
  roundsVal.textContent = settings.rounds;
  roundsSlider.oninput = () => {
    roundsVal.textContent = roundsSlider.value;
    updateRoomSettings();
  };

  // Time slider
  const timeSlider = el('setting-time');
  const timeVal = el('setting-time-val');
  timeSlider.value = settings.timePerQuestion;
  timeVal.textContent = settings.timePerQuestion;
  timeSlider.oninput = () => {
    timeVal.textContent = timeSlider.value;
    updateRoomSettings();
  };

  // Categories
  const catsContainer = el('categories-grid');
  catsContainer.innerHTML = '';

  const cats = window.CATEGORIES || {};
  Object.values(cats).forEach(cat => {
    const chip = document.createElement('div');
    const isSelected = settings.categories.includes(cat.id);
    chip.className = `category-chip ${isSelected ? 'selected' : ''}`;
    chip.style.color = cat.color;
    chip.dataset.catId = cat.id;
    chip.innerHTML = `<span class="cat-icon">${cat.icon}</span><span>${cat.name}</span>`;
    chip.onclick = () => {
      chip.classList.toggle('selected');
      updateRoomSettings();
    };
    catsContainer.appendChild(chip);
  });
}

function updateSettingsDisplay(settings) {
  el('display-rounds').textContent = settings.rounds;
  el('display-time').textContent = settings.timePerQuestion + 'ث';
  const cats = (settings.categories || []).map(id => window.CATEGORIES?.[id]?.icon || '').join(' ');
  el('display-categories').textContent = cats;
}

async function updateRoomSettings() {
  const rounds = parseInt(el('setting-rounds').value);
  const time = parseInt(el('setting-time').value);
  const selectedCats = [...document.querySelectorAll('.category-chip.selected')].map(c => c.dataset.catId);

  if (selectedCats.length === 0) {
    showToast('اختر فئة واحدة على الأقل', 'warning');
    return;
  }

  const settings = { rounds, timePerQuestion: time, categories: selectedCats };
  gState.settings = settings;

  await window.firebaseManager.updateRoom(gState.roomCode, { settings });
}

// ============================================================
// START GAME (HOST only)
// ============================================================
async function startGame() {
  if (!gState.isHost) return;

  const fm = window.firebaseManager;
  const roomData = await fm.getRoom(gState.roomCode);
  if (!roomData) return;

  const players = roomData.players || {};
  const playerCount = Object.keys(players).length;
  if (playerCount < 1) { showToast('يجب وجود لاعب واحد على الأقل', 'warning'); return; }

  // Build question set
  const settings = roomData.settings || gState.settings;
  const questions = buildQuestionSet(settings);

  if (questions.length === 0) {
    showToast('لا توجد أسئلة للفئات المختارة', 'error');
    return;
  }

  AudioEngine.start();

  const gameData = {
    questions,
    currentRound: 0,
    totalRounds: questions.length,
    answers: {},
    scores: {},
    roundStartTime: Date.now()
  };

  // Init scores to 0
  Object.keys(players).forEach(pid => gameData.scores[pid] = 0);

  await fm.updateRoom(gState.roomCode, {
    status: 'playing',
    game: gameData
  });
}

// ============================================================
// PLAYING PHASE
// ============================================================
function startGamePhase(roomData) {
  const game = roomData.game;
  if (!game) return;

  clearTimer();

  gState.questions = game.questions;
  gState.currentRound = game.currentRound;
  gState.totalRounds = game.totalRounds;
  gState.hasSubmitted = false;
  gState.selectedWager = null;
  gState.maxTime = roomData.settings?.timePerQuestion || 30;

  // Load player's usedWagers
  const myPlayer = roomData.players?.[gState.playerId];
  gState.usedWagers = myPlayer?.usedWagers || [];

  showPage('game');
  renderQuestion(game.questions[game.currentRound], game.currentRound, game.totalRounds, roomData.settings);
  startTimer(gState.maxTime, () => autoSubmitAnswer());

  AudioEngine.newRound();
}

function renderQuestion(q, roundIdx, total, settings) {
  // Progress
  el('round-current').textContent = roundIdx + 1;
  el('round-total').textContent = total;
  el('progress-bar').style.width = `${((roundIdx + 1) / total) * 100}%`;

  // Timer max
  const duration = settings?.timePerQuestion || 30;
  gState.maxTime = duration;

  // Category badge
  const badge = el('question-category-badge');
  badge.style.color = q.categoryColor;
  badge.innerHTML = `${q.categoryIcon} ${q.categoryName}`;

  // Question text
  el('question-text').textContent = q.q;

  // Difficulty
  el('question-difficulty').textContent = DIFFICULTY_LABELS[q.difficulty] || '';

  // Wager buttons
  renderWagerButtons();

  // Reset answer
  const ansInput = el('answer-input');
  ansInput.value = '';
  ansInput.disabled = false;
  ansInput.classList.remove('submitted');

  el('btn-submit-answer').disabled = false;
  el('btn-submit-answer').textContent = '✓ أرسل';

  // Focus
  setTimeout(() => ansInput.focus(), 300);

  // Submitted count
  el('submitted-count').textContent = '0';
}

function renderWagerButtons() {
  const container = el('wager-grid');
  container.innerHTML = '';

  for (let i = 1; i <= 20; i++) {
    const btn = document.createElement('button');
    btn.className = 'wager-btn';
    btn.textContent = i;
    btn.dataset.val = i;

    const isUsed = gState.usedWagers.includes(i);
    if (isUsed) {
      btn.disabled = true;
      btn.title = 'استخدمت هذا الرقم مسبقاً';
    } else {
      btn.onclick = () => selectWager(i);
    }
    container.appendChild(btn);
  }
}

function selectWager(val) {
  if (gState.hasSubmitted) return;
  gState.selectedWager = val;

  document.querySelectorAll('.wager-btn').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.dataset.val) === val);
  });

  el('selected-wager-display').textContent = val;
}

async function submitAnswer() {
  if (gState.hasSubmitted) return;

  const answer = el('answer-input').value.trim();
  if (!answer) { showToast('أكتب إجابتك أولاً', 'warning'); return; }
  if (gState.selectedWager === null) { showToast('اختر عدد النقاط أولاً', 'warning'); return; }

  gState.hasSubmitted = true;

  const fm = window.firebaseManager;
  const q = gState.questions[gState.currentRound];

  const answerData = {
    playerId: gState.playerId,
    playerName: gState.playerName,
    playerAvatar: gState.playerAvatar,
    playerAvatarColor: gState.playerAvatarColor,
    answer,
    wager: gState.selectedWager,
    correct: null, // to be marked by host
    autoChecked: checkAnswer(answer, q.a),
    submittedAt: Date.now()
  };

  // Update usedWager in player data
  const newUsed = [...gState.usedWagers, gState.selectedWager];
  gState.usedWagers = newUsed;

  await fm.updatePath(`rooms/${gState.roomCode}`, {
    [`game/answers/${gState.currentRound}/${gState.playerId}`]: answerData,
    [`players/${gState.playerId}/usedWagers`]: newUsed
  });

  // Update UI
  el('answer-input').classList.add('submitted');
  el('answer-input').disabled = true;
  el('btn-submit-answer').disabled = true;
  el('btn-submit-answer').textContent = '✓ تم الإرسال';

  showToast('تم إرسال إجابتك ✓', 'success');
}

async function autoSubmitAnswer() {
  if (gState.hasSubmitted) return;
  if (!gState.selectedWager) {
    // Auto-pick lowest unused wager
    for (let i = 1; i <= 20; i++) {
      if (!gState.usedWagers.includes(i)) {
        gState.selectedWager = i;
        break;
      }
    }
  }

  const answer = el('answer-input').value.trim();
  if (answer) {
    await submitAnswer();
  } else {
    // Empty answer submission
    gState.hasSubmitted = true;
    const wager = gState.selectedWager || 1;
    const fm = window.firebaseManager;

    const answerData = {
      playerId: gState.playerId,
      playerName: gState.playerName,
      playerAvatar: gState.playerAvatar,
      playerAvatarColor: gState.playerAvatarColor,
      answer: '(لم يجب)',
      wager,
      correct: false,
      autoChecked: false,
      submittedAt: Date.now()
    };

    const newUsed = [...gState.usedWagers, wager];
    gState.usedWagers = newUsed;

    await fm.updatePath(`rooms/${gState.roomCode}`, {
      [`game/answers/${gState.currentRound}/${gState.playerId}`]: answerData,
      [`players/${gState.playerId}/usedWagers`]: newUsed
    });

    el('answer-input').disabled = true;
    el('btn-submit-answer').disabled = true;
  }

  // Auto-reveal if host
  if (gState.isHost) {
    await revealResults();
  }
}

function updatePlayingUI(roomData) {
  const answers = roomData.game?.answers?.[gState.currentRound] || {};
  const count = Object.keys(answers).length;
  el('submitted-count').textContent = count;

  // If all submitted and host, auto reveal after 2s
  const playerCount = Object.keys(roomData.players || {}).length;
  if (gState.isHost && count >= playerCount && gState.phase === 'playing') {
    setTimeout(() => revealResults(), 2000);
  }
}

// ============================================================
// TIMER
// ============================================================
function startTimer(seconds, onEnd, isFinal = false) {
  clearTimer();
  gState.timeLeft = seconds;

  const progressId = isFinal ? 'final-timer-progress' : 'timer-progress';
  const numId      = isFinal ? 'final-timer-number'   : 'timer-number';

  const progress = el(progressId);
  const numEl    = el(numId);
  const circumference = 163;

  if (!progress || !numEl) { console.warn('Timer elements not found'); return; }

  function update() {
    const ratio = gState.timeLeft / gState.maxTime;
    progress.style.strokeDashoffset = circumference * (1 - ratio);
    numEl.textContent = gState.timeLeft;

    const warn  = gState.timeLeft <= Math.floor(gState.maxTime * 0.4);
    const danger= gState.timeLeft <= Math.floor(gState.maxTime * 0.2);

    progress.className = `timer-progress${danger ? ' danger' : warn ? ' warning' : ''}`;
    numEl.className = `timer-number${danger ? ' danger' : warn ? ' warning' : ''}`;

    if (danger) AudioEngine.urgentTick();
    else if (warn) AudioEngine.tick();
  }

  update();

  gState.timerInterval = setInterval(() => {
    gState.timeLeft--;
    update();
    if (gState.timeLeft <= 0) {
      clearTimer();
      onEnd();
    }
  }, 1000);
}

function clearTimer() {
  if (gState.timerInterval) {
    clearInterval(gState.timerInterval);
    gState.timerInterval = null;
  }
}

// ============================================================
// RESULTS PHASE
// ============================================================
async function revealResults() {
  if (!gState.isHost) return;
  clearTimer();
  await window.firebaseManager.updateRoom(gState.roomCode, { status: 'results' });
}

function showResultsPhase(roomData) {
  clearTimer();
  showPage('results');

  const game = roomData.game;
  const round = game.currentRound;
  const q     = game.questions[round];
  const answers = game.answers?.[round] || {};

  el('results-question').textContent = q.q;
  el('results-correct-answer').textContent = q.a[0];
  el('results-round-num').textContent = round + 1;

  renderAnswersList(answers, roomData);

  // Host controls
  if (gState.isHost) {
    el('host-results-controls').classList.remove('hidden');
    el('btn-next-round').onclick = () => proceedToNextRound(roomData);
    el('btn-next-round').textContent = round + 1 >= game.totalRounds ? '🏁 الجولة النهائية' : '➡ الجولة التالية';
  } else {
    el('host-results-controls').classList.add('hidden');
  }

  renderLeaderboard(roomData);
}

function renderAnswersList(answers, roomData) {
  const list = el('answers-list');
  list.innerHTML = '';

  Object.values(answers).forEach(ans => {
    const row = document.createElement('div');
    const isCorrect = ans.correct === true;
    const isWrong   = ans.correct === false;
    row.className = `answer-row ${isCorrect ? 'correct' : isWrong ? 'wrong' : ''}`;
    row.dataset.playerId = ans.playerId;

    const autoIcon = ans.autoChecked ? '🟡' : '';

    row.innerHTML = `
      <div class="answer-player-avatar" style="background:${ans.playerAvatarColor}">${ans.playerAvatar}</div>
      <div>
        <div class="answer-player-name">${escHtml(ans.playerName)}</div>
        <div class="answer-text">${escHtml(ans.answer)} ${autoIcon}</div>
      </div>
      <div class="answer-wager">⚡${ans.wager}</div>
      <div class="answer-status">${isCorrect ? '✅' : isWrong ? '❌' : '⏳'}</div>
      ${gState.isHost ? `
      <div class="answer-status-btn">
        <button class="mark-btn correct-btn ${isCorrect ? 'active' : ''}" data-pid="${ans.playerId}" data-mark="correct" title="صحيح">✅</button>
        <button class="mark-btn wrong-btn ${isWrong ? 'active' : ''}" data-pid="${ans.playerId}" data-mark="wrong" title="خطأ">❌</button>
      </div>` : '<div></div>'}
    `;
    list.appendChild(row);
  });

  // Host mark buttons
  if (gState.isHost) {
    document.querySelectorAll('.mark-btn').forEach(btn => {
      btn.onclick = () => markAnswer(btn.dataset.pid, btn.dataset.mark, answers, roomData.game.currentRound);
    });
  }
}

async function markAnswer(playerId, mark, currentAnswers, round) {
  const fm = window.firebaseManager;
  const isCorrect = mark === 'correct';
  const ans = currentAnswers[playerId];
  if (!ans) return;

  const points = isCorrect ? ans.wager : 0;
  const roomData = await fm.getRoom(gState.roomCode);
  const currentScore = roomData.game.scores[playerId] || 0;

  let newScore = currentScore;
  // Remove previous mark effect if any
  const prevCorrect = ans.correct;
  if (prevCorrect === true && !isCorrect) newScore -= ans.wager;
  if (prevCorrect === false && isCorrect) newScore += ans.wager;
  if (prevCorrect === null) newScore += points;

  await fm.updatePath(`rooms/${gState.roomCode}`, {
    [`game/answers/${round}/${playerId}/correct`]: isCorrect,
    [`game/scores/${playerId}`]: Math.max(0, newScore)
  });

  if (isCorrect) AudioEngine.correct();
  else AudioEngine.wrong();
}

function updateResultsMarking(roomData) {
  const round = roomData.game.currentRound;
  const answers = roomData.game?.answers?.[round] || {};

  Object.values(answers).forEach(ans => {
    const row = document.querySelector(`.answer-row[data-player-id="${ans.playerId}"]`);
    if (row) {
      row.className = `answer-row ${ans.correct === true ? 'correct' : ans.correct === false ? 'wrong' : ''}`;
    }
  });

  renderLeaderboard(roomData);
}

// ============================================================
// LEADERBOARD
// ============================================================
function renderLeaderboard(roomData) {
  const scores = roomData.game?.scores || {};
  const players = roomData.players || {};

  const sorted = Object.keys(scores)
    .map(pid => ({
      id: pid,
      name: players[pid]?.name || pid,
      avatar: players[pid]?.avatar || '?',
      avatarColor: players[pid]?.avatarColor || 'var(--gradient-main)',
      score: scores[pid] || 0
    }))
    .sort((a, b) => b.score - a.score);

  const lb = el('leaderboard');
  lb.innerHTML = '';

  const rankIcons = ['🥇', '🥈', '🥉'];
  const rankClasses = ['rank-1', 'rank-2', 'rank-3'];

  sorted.forEach((p, idx) => {
    const entry = document.createElement('div');
    entry.className = `lb-entry ${rankClasses[idx] || ''} ${p.id === gState.playerId ? 'me-entry' : ''}`;
    entry.style.animationDelay = `${idx * 0.1}s`;

    const rankIcon = rankIcons[idx] || `#${idx + 1}`;

    entry.innerHTML = `
      <div class="lb-rank ${idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : ''}">${rankIcon}</div>
      <div class="lb-avatar" style="background:${p.avatarColor}">${p.avatar}</div>
      <div class="lb-name">${escHtml(p.name)} ${p.id === gState.playerId ? '<span style="font-size:0.75rem;color:var(--text-muted)">(أنت)</span>' : ''}</div>
      <div class="lb-score">${p.score}</div>
    `;
    lb.appendChild(entry);
  });
}

// ============================================================
// NEXT ROUND
// ============================================================
async function proceedToNextRound(roomData) {
  if (!gState.isHost) return;
  const game = roomData.game;
  const nextRound = game.currentRound + 1;

  // Check if all rounds done -> voting
  if (nextRound >= game.totalRounds) {
    await window.firebaseManager.updateRoom(gState.roomCode, {
      status: 'voting',
      'game/votes': {}
    });
    return;
  }

  await window.firebaseManager.updateRoom(gState.roomCode, {
    status: 'next_round',
    'game/currentRound': nextRound,
    'game/roundStartTime': Date.now(),
    'game/answers': game.answers || {}
  });
}

// ============================================================
// VOTING PHASE (pre-final)
// ============================================================
function showVotingPhase(roomData) {
  showPage('voting');
  el('voting-round-display').innerHTML = `
    <div class="final-badge">⭐ الجولة النهائية قادمة!</div>
    <h2 style="font-size:1.8rem;font-weight:900;margin:16px 0">صوّت على إعدادات السؤال الأخير</h2>
    <p style="color:var(--text-secondary)">إذا أجبت صح تحصل على النقاط، إذا أجبت غلط تُخصم منك!</p>
  `;

  renderVotingOptions(roomData);
}

function renderVotingOptions(roomData) {
  const votes = roomData.game?.votes || {};
  const myVote = votes[gState.playerId];

  // Difficulty voting
  const diffContainer = el('vote-difficulty');
  diffContainer.innerHTML = '';
  FINAL_ROUND_DIFFICULTIES.forEach(diff => {
    const count = Object.values(votes).filter(v => v?.difficulty === diff).length;
    const btn = document.createElement('div');
    btn.className = `vote-option ${myVote?.difficulty === diff ? 'voted' : ''}`;
    btn.innerHTML = `
      <div style="font-size:1.5rem">${diff === 'easy' ? '😊' : diff === 'medium' ? '😐' : '🤯'}</div>
      <div>${DIFFICULTY_LABELS[diff]}</div>
      <div class="vote-count ${myVote?.difficulty === diff ? 'voted' : ''}">${count} صوت</div>
    `;
    btn.onclick = () => castVote('difficulty', diff);
    diffContainer.appendChild(btn);
  });

  // Points voting
  const ptsContainer = el('vote-points');
  ptsContainer.innerHTML = '';
  FINAL_ROUND_POINTS.forEach(pts => {
    const count = Object.values(votes).filter(v => v?.points === pts).length;
    const btn = document.createElement('div');
    btn.className = `vote-option ${myVote?.points === pts ? 'voted' : ''}`;
    btn.innerHTML = `
      <div style="font-size:1.5rem">${pts === 0 ? '🆓' : pts === 10 ? '💰' : '💎'}</div>
      <div>${pts} نقطة</div>
      <div class="vote-count ${myVote?.points === pts ? 'voted' : ''}">${count} صوت</div>
    `;
    btn.onclick = () => castVote('points', pts);
    ptsContainer.appendChild(btn);
  });

  // Check if everyone voted -> host can proceed
  const players = roomData.players || {};
  const allVoted = Object.keys(players).every(pid => votes[pid]?.difficulty && votes[pid]?.points !== undefined);

  if (gState.isHost) {
    el('btn-start-final').classList.remove('hidden');
    el('btn-start-final').disabled = !allVoted;
    el('btn-start-final').textContent = allVoted ? '🚀 ابدأ الجولة النهائية' : 'انتظر تصويت الجميع...';
    el('btn-start-final').onclick = () => startFinalRoundFromHost(roomData);
  }
}

function updateVotingUI(roomData) {
  renderVotingOptions(roomData);
}

async function castVote(type, value) {
  const fm = window.firebaseManager;
  await fm.updatePath(`rooms/${gState.roomCode}/game/votes/${gState.playerId}`, {
    [type]: value
  });
  showToast('تم تسجيل صوتك ✅', 'success');
}

async function startFinalRoundFromHost(roomData) {
  const votes = roomData.game?.votes || {};

  // Tally votes
  const diffVotes = {};
  const ptsVotes  = {};
  Object.values(votes).forEach(v => {
    if (v.difficulty) diffVotes[v.difficulty] = (diffVotes[v.difficulty] || 0) + 1;
    if (v.points !== undefined) ptsVotes[v.points] = (ptsVotes[v.points] || 0) + 1;
  });

  const winDiff = Object.keys(diffVotes).sort((a,b) => diffVotes[b] - diffVotes[a])[0] || 'medium';
  const winPts  = parseInt(Object.keys(ptsVotes).sort((a,b) => ptsVotes[b] - ptsVotes[a])[0] ?? '10');

  // Pick a final question of that difficulty
  const allCats = Object.values(window.CATEGORIES || {});
  const allQs = allCats.flatMap(c => c.questions.map(q => ({ ...q, category: c.id, categoryName: c.name, categoryIcon: c.icon, categoryColor: c.color })));
  const filtered = allQs.filter(q => q.difficulty === winDiff);
  const finalQ = filtered[Math.floor(Math.random() * filtered.length)] || allQs[0];

  await window.firebaseManager.updateRoom(gState.roomCode, {
    status: 'final',
    'game/finalQuestion': finalQ,
    'game/finalPoints': winPts,
    'game/finalDifficulty': winDiff,
    'game/finalAnswers': {},
    'game/roundStartTime': Date.now()
  });
}

// ============================================================
// FINAL ROUND
// ============================================================
function startFinalRound(roomData) {
  clearTimer();
  showPage('final');

  const game = roomData.game;
  const finalQ = game.finalQuestion;
  const finalPts = game.finalPoints;

  el('final-question-text').textContent = finalQ?.q || 'السؤال النهائي';
  el('final-pts-badge').textContent = `±${finalPts} نقطة`;
  el('final-category-badge').innerHTML = `${finalQ?.categoryIcon} ${finalQ?.categoryName}`;

  gState.hasSubmitted = false;
  el('final-answer-input').value = '';
  el('final-answer-input').disabled = false;
  el('btn-submit-final').disabled = false;

  el('btn-submit-final').onclick = () => submitFinalAnswer(roomData);

  const duration = roomData.settings?.timePerQuestion || 30;
  startTimer(duration, () => autoSubmitFinalAnswer(roomData), true);
}

async function submitFinalAnswer(roomData) {
  if (gState.hasSubmitted) return;
  const answer = el('final-answer-input').value.trim();
  if (!answer) { showToast('أكتب إجابتك', 'warning'); return; }

  gState.hasSubmitted = true;
  clearTimer();

  const fm = window.firebaseManager;
  const q = roomData.game.finalQuestion;

  const ansData = {
    playerId: gState.playerId,
    playerName: gState.playerName,
    playerAvatar: gState.playerAvatar,
    playerAvatarColor: gState.playerAvatarColor,
    answer,
    autoChecked: checkAnswer(answer, q.a),
    correct: null,
    submittedAt: Date.now()
  };

  await fm.setPath(`rooms/${gState.roomCode}/game/finalAnswers/${gState.playerId}`, ansData);

  el('final-answer-input').disabled = true;
  el('btn-submit-final').disabled = true;
  showToast('تم إرسال إجابتك ✓', 'success');

  // Auto reveal if host
  if (gState.isHost) {
    setTimeout(() => revealFinalResults(), 3000);
  }
}

async function autoSubmitFinalAnswer(roomData) {
  if (gState.hasSubmitted) return;
  const answer = el('final-answer-input').value.trim() || '(لم يجب)';
  el('final-answer-input').value = answer;
  await submitFinalAnswer({ ...roomData, game: { ...roomData.game } });
}

async function revealFinalResults() {
  if (!gState.isHost) return;
  await window.firebaseManager.updateRoom(gState.roomCode, { status: 'final_results' });
}

function showFinalResults(roomData) {
  clearTimer();
  showPage('final-results');

  const game = roomData.game;
  const finalQ = game.finalQuestion;
  const finalPts = game.finalPoints;
  const answers = game.finalAnswers || {};

  el('final-results-question').textContent = finalQ?.q;
  el('final-results-correct').textContent = finalQ?.a?.[0];

  const list = el('final-answers-list');
  list.innerHTML = '';

  Object.values(answers).forEach(ans => {
    const row = document.createElement('div');
    const isCorrect = ans.correct === true;
    const isWrong   = ans.correct === false;
    row.className = `answer-row ${isCorrect ? 'correct' : isWrong ? 'wrong' : ''}`;
    row.dataset.pid = ans.playerId;

    row.innerHTML = `
      <div class="answer-player-avatar" style="background:${ans.playerAvatarColor}">${ans.playerAvatar}</div>
      <div>
        <div class="answer-player-name">${escHtml(ans.playerName)}</div>
        <div class="answer-text">${escHtml(ans.answer)}</div>
      </div>
      <div></div>
      <div class="answer-status">${isCorrect ? '✅' : isWrong ? '❌' : '⏳'}</div>
      ${gState.isHost ? `
      <div class="answer-status-btn">
        <button class="mark-btn correct-btn ${isCorrect ? 'active' : ''}" data-pid="${ans.playerId}" data-mark="correct">✅</button>
        <button class="mark-btn wrong-btn ${isWrong ? 'active' : ''}" data-pid="${ans.playerId}" data-mark="wrong">❌</button>
      </div>` : '<div></div>'}
    `;
    list.appendChild(row);
  });

  if (gState.isHost) {
    document.querySelectorAll('#final-answers-list .mark-btn').forEach(btn => {
      btn.onclick = () => markFinalAnswer(btn.dataset.pid, btn.dataset.mark, answers, game);
    });
    el('btn-show-winner').classList.remove('hidden');
    el('btn-show-winner').onclick = () => showWinnerFromHost();
  } else {
    el('btn-show-winner').classList.add('hidden');
  }

  renderFinalLeaderboard(roomData);
}

async function markFinalAnswer(playerId, mark, answers, game) {
  const fm = window.firebaseManager;
  const isCorrect = mark === 'correct';
  const finalPts = game.finalPoints || 0;
  const roomData = await fm.getRoom(gState.roomCode);
  const currentScore = roomData.game.scores[playerId] || 0;

  const prevCorrect = answers[playerId]?.correct;
  let newScore = currentScore;

  if (prevCorrect === null || prevCorrect === undefined) {
    newScore += isCorrect ? finalPts : -finalPts;
  } else if (prevCorrect === true && !isCorrect) {
    newScore -= finalPts * 2;
  } else if (prevCorrect === false && isCorrect) {
    newScore += finalPts * 2;
  }

  await fm.updatePath(`rooms/${gState.roomCode}`, {
    [`game/finalAnswers/${playerId}/correct`]: isCorrect,
    [`game/scores/${playerId}`]: Math.max(0, newScore)
  });

  if (isCorrect) { AudioEngine.correct(); showScorePop(finalPts, null, null); }
  else { AudioEngine.wrong(); showScorePop(-finalPts, null, null); }
}

function renderFinalLeaderboard(roomData) {
  const scores = roomData.game?.scores || {};
  const players = roomData.players || {};

  const sorted = Object.keys(scores)
    .map(pid => ({
      id: pid,
      name: players[pid]?.name || pid,
      avatar: players[pid]?.avatar || '?',
      avatarColor: players[pid]?.avatarColor || 'var(--gradient-main)',
      score: scores[pid] || 0
    }))
    .sort((a, b) => b.score - a.score);

  const lb = el('final-leaderboard');
  lb.innerHTML = '';

  sorted.forEach((p, idx) => {
    const entry = document.createElement('div');
    entry.className = `lb-entry ${idx < 3 ? `rank-${idx+1}` : ''} ${p.id === gState.playerId ? 'me-entry' : ''}`;
    entry.innerHTML = `
      <div class="lb-rank">${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`}</div>
      <div class="lb-avatar" style="background:${p.avatarColor}">${p.avatar}</div>
      <div class="lb-name">${escHtml(p.name)}</div>
      <div class="lb-score">${p.score}</div>
    `;
    lb.appendChild(entry);
  });
}

async function showWinnerFromHost() {
  await window.firebaseManager.updateRoom(gState.roomCode, { status: 'winner' });
}

// ============================================================
// WINNER SCREEN
// ============================================================
function showWinnerScreen(roomData) {
  clearTimer();
  showPage('winner');

  const scores = roomData.game?.scores || {};
  const players = roomData.players || {};

  const sorted = Object.keys(scores)
    .map(pid => ({
      id: pid,
      name: players[pid]?.name || pid,
      avatar: players[pid]?.avatar || '🏆',
      avatarColor: players[pid]?.avatarColor,
      score: scores[pid] || 0
    }))
    .sort((a, b) => b.score - a.score);

  const winner = sorted[0];

  if (!winner) return;

  el('winner-avatar').style.background = winner.avatarColor;
  el('winner-avatar').textContent = winner.avatar;
  el('winner-name').textContent = winner.name;
  el('winner-score').textContent = winner.score + ' نقطة';
  el('winner-is-me').textContent = winner.id === gState.playerId ? '🎉 أنت الفائز!' : '';

  // Final leaderboard
  renderFinalLeaderboardWinner(sorted);

  launchConfetti(80);
  AudioEngine.win();

  el('btn-play-again').onclick = () => showPage('home');
}

function renderFinalLeaderboardWinner(sorted) {
  const lb = el('winner-leaderboard');
  lb.innerHTML = '';
  sorted.forEach((p, idx) => {
    const entry = document.createElement('div');
    entry.className = `lb-entry ${idx < 3 ? `rank-${idx+1}` : ''} ${p.id === gState.playerId ? 'me-entry' : ''}`;
    entry.innerHTML = `
      <div class="lb-rank">${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`}</div>
      <div class="lb-avatar" style="background:${p.avatarColor}">${p.avatar}</div>
      <div class="lb-name">${escHtml(p.name)}</div>
      <div class="lb-score">${p.score}</div>
    `;
    lb.appendChild(entry);
  });
}

// ============================================================
// XSS PROTECTION
// ============================================================
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// CHAT SYSTEM
// ============================================================
let chatOpen = false;
let chatUnread = 0;
let chatListener = null;
let lastChatCount = 0;

function showChat() {
  chatOpen = true;
  el('chat-panel').classList.add('open');
  el('chat-panel').setAttribute('aria-hidden', 'false');
  chatUnread = 0;
  el('chat-unread-badge').classList.remove('show');
  el('chat-unread-badge').textContent = '0';
  scrollChatToBottom();
}

function hideChat() {
  chatOpen = false;
  el('chat-panel').classList.remove('open');
  el('chat-panel').setAttribute('aria-hidden', 'true');
}

function toggleChat() {
  chatOpen ? hideChat() : showChat();
}

function showChatFab() {
  el('chat-fab').classList.add('visible');
}

function hideChatFab() {
  el('chat-fab').classList.remove('visible');
  hideChat();
}

function scrollChatToBottom() {
  const msgs = el('chat-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

async function sendChatMessage() {
  const input = el('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text || !gState.roomCode || !gState.playerId) return;

  input.value = '';

  const fm = window.firebaseManager;
  const msgData = {
    senderId: gState.playerId,
    senderName: gState.playerName,
    senderAvatar: gState.playerAvatar,
    text: escHtml(text),
    ts: Date.now()
  };

  // Push to Firebase
  const { ref, push } = fm.dbFns;
  try {
    await push(ref(fm.db, `rooms/${gState.roomCode}/chat`), msgData);
  } catch(e) {
    showToast('فشل إرسال الرسالة', 'error');
  }
}

function listenToChat() {
  if (!gState.roomCode || !window.firebaseManager?.initialized) return;
  const fm = window.firebaseManager;

  if (chatListener) chatListener();

  chatListener = fm.listenToPath(`rooms/${gState.roomCode}/chat`, (data) => {
    if (!data) return;

    const messages = Object.values(data).sort((a, b) => a.ts - b.ts);

    // Clear empty state
    const msgsEl = el('chat-messages');
    if (!msgsEl) return;

    if (messages.length > lastChatCount) {
      if (messages.length === 1) {
        msgsEl.innerHTML = ''; // Remove empty state
      }

      const newMessages = messages.slice(lastChatCount);
      newMessages.forEach(msg => {
        const isMe = msg.senderId === gState.playerId;
        const div = document.createElement('div');
        div.className = `chat-msg ${isMe ? 'me' : 'others'}`;

        const time = new Date(msg.ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        div.innerHTML = `
          ${!isMe ? `<div class="chat-msg-header"><span class="chat-sender">${msg.senderAvatar} ${escHtml(msg.senderName)}</span></div>` : ''}
          <div class="chat-bubble">${escHtml(msg.text)}</div>
          ${isMe ? `<div class="chat-msg-header" style="text-align:right">${time}</div>` : `<div class="chat-msg-header">${time}</div>`}
        `;
        msgsEl.appendChild(div);
      });

      // Unread badge if chat is closed
      if (!chatOpen && lastChatCount > 0) {
        chatUnread += newMessages.length;
        el('chat-unread-badge').textContent = chatUnread > 9 ? '9+' : chatUnread;
        el('chat-unread-badge').classList.add('show');
      }

      lastChatCount = messages.length;
      scrollChatToBottom();
    }
  });
}

function sendSystemChatMsg(text) {
  if (!gState.roomCode || !window.firebaseManager?.initialized) return;
  if (!gState.isHost) return; // only host sends system messages

  const fm = window.firebaseManager;
  const { ref, push } = fm.dbFns;
  push(ref(fm.db, `rooms/${gState.roomCode}/chat`), {
    senderId: 'system',
    senderName: 'نظام',
    senderAvatar: '🤖',
    text,
    system: true,
    ts: Date.now()
  }).catch(() => {});
}

// Override renderChatSystemMsg to handle system bubbles
const _origListenToChat = listenToChat;

// Patch listenToPath to handle system messages style
function patchSystemMessages() {
  // Override chat message rendering for system messages
  const msgsEl = el('chat-messages');
  if (!msgsEl) return;

  // MutationObserver to style system messages
  const obs = new MutationObserver(() => {
    msgsEl.querySelectorAll('.chat-msg:not([data-styled])').forEach(div => {
      div.dataset.styled = '1';
    });
  });
  obs.observe(msgsEl, { childList: true });
}

// ============================================================
// INITIALIZE
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  initHome();
  initModals();
  showPage('home');

  // Global submit answer
  el('btn-submit-answer')?.addEventListener('click', submitAnswer);

  // Enter key on answer input
  el('answer-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAnswer();
  });

  // Final answer Enter key
  el('final-answer-input')?.addEventListener('keydown', (e) => {
    // handled by button onclick
  });

  // Host reveal button
  el('btn-reveal-results')?.addEventListener('click', revealResults);

  // Chat FAB & panel
  el('chat-fab')?.addEventListener('click', toggleChat);
  el('chat-close-btn')?.addEventListener('click', hideChat);

  el('chat-send-btn')?.addEventListener('click', sendChatMessage);
  el('chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });

  console.log('🎮 Sporcel Party initialized!');
});

// Patch showLobby / startGamePhase / etc. to show/hide chat FAB
const _origShowLobby = showLobby;
showLobby = function(roomData) {
  _origShowLobby(roomData);
  showChatFab();
  lastChatCount = 0;
  chatUnread = 0;
  listenToChat();
};

const _origShowPage_home = showPage;
showPage = function(pageId) {
  _origShowPage_home(pageId);
  if (pageId === 'home') {
    hideChatFab();
    if (chatListener) { chatListener(); chatListener = null; }
  }
};

