// roundRect polyfill for older browsers
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (typeof r === 'number') r = [r, r, r, r];
        else if (!Array.isArray(r)) r = [0, 0, 0, 0];
        const [tl, tr, br, bl] = r;
        this.moveTo(x + tl, y);
        this.lineTo(x + w - tr, y);
        this.quadraticCurveTo(x + w, y, x + w, y + tr);
        this.lineTo(x + w, y + h - br);
        this.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
        this.lineTo(x + bl, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - bl);
        this.lineTo(x, y + tl);
        this.quadraticCurveTo(x, y, x + tl, y);
        this.closePath();
    };
}

// ===== Firebase Config =====
const firebaseConfig = {
    apiKey: "AIzaSyCp9_P3K__Sr76iKgaVG1iD4NluUqPtni4",
    authDomain: "heka-codenames.firebaseapp.com",
    databaseURL: "https://heka-codenames-default-rtdb.firebaseio.com",
    projectId: "heka-codenames",
    storageBucket: "heka-codenames.firebasestorage.app",
    messagingSenderId: "901713932504",
    appId: "1:901713932504:web:7079662022a501e9c4e7ad"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ===== Constants =====
const COLORS = ['red', 'blue', 'yellow', 'green'];
const COLOR_AR = { red: 'الأحمر', blue: 'الأزرق', yellow: 'الأصفر', green: 'الأخضر' };
const COLOR_HEX = { red: '#ef4444', blue: '#3b82f6', yellow: '#eab308', green: '#22c55e' };
const COLOR_GLOW = { red: 'rgba(239,68,68,.4)', blue: 'rgba(59,130,246,.4)', yellow: 'rgba(234,179,8,.4)', green: 'rgba(34,197,94,.4)' };
const HOME_START = { red: 0, blue: 13, yellow: 26, green: 39 };
const SAFE_SPOTS = [0, 8, 13, 21, 26, 34, 39, 47];
const BOARD_SIZE = 52;

// ===== Game State =====
let G = {
    mode: null, // 'local','online','bot'
    roomId: '',
    myColor: null,
    myName: 'مجهول',
    numPlayers: 4,
    currentTurn: 0,
    players: [],
    dice: 0,
    diceRolled: false,
    sixCount: 0,
    gameOver: false,
    winner: null,
    rankings: [],
    powerUps: { shield: 1, doubleMove: 1, swap: 1 },
    usedPowerUps: {},
    moveHistory: [],
    turnTimer: null,
    turnTimeLeft: 30,
    totalMoves: {},
    captures: {},
    finishedPieces: {},
    streakSixes: {},
    combo: 0,
    lastCaptureBy: null,
    soundOn: true,
    vibrationOn: true,
    animating: false,
    chatOpen: false,
    emojis: ['😂', '🔥', '💪', '😎', '🎉', '💀', '🤯', '👏', '😤', '🥳'],
    _audioCtx: null,
};

// ===== Full cleanup on page unload/back =====
// When player leaves (back button, close tab, etc.), stop EVERYTHING to free RAM
// The onDisconnect().remove() on presence will tell the host this player left
// so a bot takes over. If they return later, they can rejoin.
window.addEventListener('pagehide', fullCleanupOnExit);
window.addEventListener('beforeunload', fullCleanupOnExit);

let _cleanedUp = false;
function fullCleanupOnExit() {
    if (_cleanedUp) return;
    _cleanedUp = true;

    // 1. Stop audio
    if (G._audioCtx) {
        try { G._audioCtx.close(); } catch(e) {}
        G._audioCtx = null;
    }
    G.soundOn = false;

    // 2. Stop turn timer
    clearTurnTimer();

    // 3. Stop animation/render loop
    cancelAnimationFrame(animFrame);

    // 4. Detach ALL Firebase listeners to stop network/RAM usage
    if (G.roomId) {
        try {
            db.ref('ludo_rooms/' + G.roomId + '/state').off();
            db.ref('ludo_rooms/' + G.roomId + '/presence').off();
            db.ref('ludo_rooms/' + G.roomId + '/chat').off();
            db.ref('ludo_rooms/' + G.roomId + '/gameStarted').off();
            db.ref('ludo_rooms/' + G.roomId + '/lobby').off();
        } catch(e) {}
        // Note: presence removal happens automatically via onDisconnect()
    }

    // 5. Clear game state to free memory
    G.players = [];
    G.validMoves = [];
    G.moveHistory = [];
}

// Audio
const SFX = {};
function initAudio() {
    const AC = new (window.AudioContext || window.webkitAudioContext)();
    G._audioCtx = AC;
    function tone(freq, dur, type = 'sine') {
        if (!G._audioCtx || G._audioCtx.state === 'closed') return;
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(0.15, AC.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
        o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + dur);
    }
    SFX.dice = () => tone(400, 0.1, 'square');
    SFX.move = () => tone(600, 0.08);
    SFX.capture = () => { tone(800, 0.1); setTimeout(() => tone(1000, 0.15), 100); };
    SFX.home = () => { tone(523, 0.1); setTimeout(() => tone(659, 0.1), 100); setTimeout(() => tone(784, 0.15), 200); };
    SFX.win = () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.2), i * 150)); };
    SFX.six = () => { tone(700, 0.08); setTimeout(() => tone(900, 0.1), 80); };
    SFX.powerup = () => { tone(440, 0.1, 'triangle'); setTimeout(() => tone(880, 0.15, 'triangle'), 100); };
    SFX.tick = () => tone(300, 0.03, 'square');
    SFX.buzz = () => tone(150, 0.2, 'sawtooth');
}
function sfx(name) { if (G.soundOn && SFX[name]) try { SFX[name](); } catch (e) { } }
function vibrate(ms) { if (G.vibrationOn && navigator.vibrate) navigator.vibrate(ms); }

// ===== Board Path Coordinates =====
// Each cell is mapped to x,y on the SVG board (15x15 grid, each cell ~40px)
const PATH_COORDS = [];
const HOME_STRETCH_COORDS = { red: [], blue: [], yellow: [], green: [] };
const BASE_COORDS = {
    red: [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]], // top-left
    blue: [[10.5, 1.5], [12.5, 1.5], [10.5, 3.5], [12.5, 3.5]], // top-right
    yellow: [[10.5, 10.5], [12.5, 10.5], [10.5, 12.5], [12.5, 12.5]], // bottom-right
    green: [[1.5, 10.5], [3.5, 10.5], [1.5, 12.5], [3.5, 12.5]] // bottom-left
};
// Center/finish
const CENTER = [6.5, 6.5];

// Build main path: 52 cells on a 15x15 grid, clockwise
(function buildPath() {
    PATH_COORDS.length = 0;
    const track = [
        // 0: RED start - exits near top-left base, goes RIGHT
        [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],              // 0-4
        // Turn UP along top arm left col
        [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],        // 5-10
        // Turn RIGHT
        [7, 0], [8, 0],                                  // 11-12
        // 13: BLUE start - exits near top-right base, goes DOWN
        [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],                // 13-17
        // Turn RIGHT along right arm top row
        [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],     // 18-23
        // Turn DOWN
        [14, 7], [14, 8],                                // 24-25
        // 26: YELLOW start - exits near bottom-right base, goes LEFT
        [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],            // 26-30
        // Turn DOWN along bottom arm right col
        [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],     // 31-36
        // Turn LEFT
        [7, 14], [6, 14],                                // 37-38
        // 39: GREEN start - exits near bottom-left base, goes UP
        [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],            // 39-43
        // Turn LEFT along left arm bottom row
        [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],        // 44-49
        // Turn UP
        [0, 7], [0, 6]                                 // 50-51
    ];
    track.forEach(c => PATH_COORDS.push(c));
    // Home stretches (5 cells each, index 0-4)
    HOME_STRETCH_COORDS.red = [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]];
    HOME_STRETCH_COORDS.blue = [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]];
    HOME_STRETCH_COORDS.yellow = [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]];
    HOME_STRETCH_COORDS.green = [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]];
})();

// ===== Initialize Game =====
function initGame(mode, numPlayers, roomId) {
    G.mode = mode;
    G.numPlayers = numPlayers || 4;
    G.roomId = roomId || '';
    G.currentTurn = 0;
    G.gameOver = false;
    G.winner = null;
    G.rankings = [];
    G.diceRolled = false;
    G.sixCount = 0;
    G.combo = 0;
    G.moveHistory = [];
    G.animating = false;
    G.totalMoves = {};
    G.captures = {};
    G.finishedPieces = {};
    G.streakSixes = {};

    const names = [G.myName, 'Bot سارة', 'Bot أحمد', 'Bot خالد'];
    
    let playColors = COLORS.slice(0, G.numPlayers);
    if (G.numPlayers === 2) playColors = ['blue', 'green'];

    G.players = [];
    for (let i = 0; i < G.numPlayers; i++) {
        const color = playColors[i];
        const isBot = (mode === 'bot' && i > 0) || false;
        G.players.push({
            color,
            name: i === 0 ? G.myName : (mode === 'bot' ? names[i] : `لاعب ${i + 1}`),
            pieces: [{ pos: -1, homeStretch: -1, finished: false }, { pos: -1, homeStretch: -1, finished: false }, { pos: -1, homeStretch: -1, finished: false }, { pos: -1, homeStretch: -1, finished: false }],
            score: 0,
            isBot,
            finished: false
        });
        G.totalMoves[color] = 0;
        G.captures[color] = 0;
        G.finishedPieces[color] = 0;
        G.streakSixes[color] = 0;
    }
    try { initAudio(); } catch (e) { }
}

// ===== Dice =====
const DICE_SVGS = [
    `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="12" fill="#000"/></svg>`,
    `<svg viewBox="0 0 100 100"><circle cx="25" cy="25" r="12" fill="#000"/><circle cx="75" cy="75" r="12" fill="#000"/></svg>`,
    `<svg viewBox="0 0 100 100"><circle cx="25" cy="25" r="12" fill="#000"/><circle cx="50" cy="50" r="12" fill="#000"/><circle cx="75" cy="75" r="12" fill="#000"/></svg>`,
    `<svg viewBox="0 0 100 100"><circle cx="25" cy="25" r="12" fill="#000"/><circle cx="75" cy="75" r="12" fill="#000"/><circle cx="25" cy="75" r="12" fill="#000"/><circle cx="75" cy="25" r="12" fill="#000"/></svg>`,
    `<svg viewBox="0 0 100 100"><circle cx="25" cy="25" r="12" fill="#000"/><circle cx="75" cy="75" r="12" fill="#000"/><circle cx="25" cy="75" r="12" fill="#000"/><circle cx="75" cy="25" r="12" fill="#000"/><circle cx="50" cy="50" r="12" fill="#000"/></svg>`,
    `<svg viewBox="0 0 100 100"><circle cx="30" cy="20" r="12" fill="#000"/><circle cx="70" cy="20" r="12" fill="#000"/><circle cx="30" cy="50" r="12" fill="#000"/><circle cx="70" cy="50" r="12" fill="#000"/><circle cx="30" cy="80" r="12" fill="#000"/><circle cx="70" cy="80" r="12" fill="#000"/></svg>`
];

function rollDice() {
    if (G.diceRolled || G.gameOver || G.animating) return;
    const player = G.players[G.currentTurn];
    if (player.isBot) return;
    // Online: only let the correct player roll (use color for reliable sync)
    if (G.mode === 'online' && player.color !== G.myColor) return;
    doRollDice();
}

function doRollDice(onComplete) {
    G.animating = true;
    const diceEl = document.getElementById('dice');
    
    let rolls = 0;
    const maxRolls = 10;
    
    diceEl.classList.add('rolling');
    
    const anim = setInterval(() => {
        const r = Math.floor(Math.random() * 6);
        diceEl.innerHTML = DICE_SVGS[r];
        rolls++;
        if (rolls >= maxRolls) {
            clearInterval(anim);
            G.dice = Math.floor(Math.random() * 6) + 1;
            diceEl.innerHTML = DICE_SVGS[G.dice - 1];
            diceEl.classList.remove('rolling');
            
            sfx('dice');
            vibrate(50);
            G.diceRolled = true;
            G.animating = false;

            if (G.mode === 'online') syncState();
            
            clearTurnTimer();
            startTurnTimer();

            if (G.dice === 6) {
                sfx('six');
                G.sixCount++;
                G.streakSixes[G.players[G.currentTurn].color]++;
                showToast('🎉 ست! العب تاني!');
                if (G.sixCount >= 3) {
                    showToast('⚠️ 3 ستات متتالية! الدور ضاع!');
                    G.sixCount = 0;
                    G.diceRolled = false;
                    nextTurn();
                    if (G.mode === 'online') syncState();
                    return;
                }
            } else {
                G.sixCount = 0;
            }

            const moves = getValidMoves();
            if (moves.length === 0) {
                showToast('مفيش حركة متاحة ❌');
                setTimeout(() => { 
                    G.diceRolled = false; 
                    nextTurn(); 
                    if (G.mode === 'online') syncState();
                }, 1000);
            } else {
                highlightMoves(moves);
                // If callback provided (bot), call it with moves
                if (typeof onComplete === 'function') {
                    onComplete(moves);
                }
            }

            if (G.mode === 'online') syncState();
            renderBoard();
        }
    }, 80);
}

// ===== Movement Logic =====
function getValidMoves() {
    const player = G.players[G.currentTurn];
    const moves = [];
    player.pieces.forEach((p, i) => {
        if (p.finished) return;
        if (p.pos === -1) {
            // In base — need 6 to come out
            if (G.dice === 6) moves.push({ pieceIdx: i, type: 'exit' });
        } else if (p.homeStretch >= 0) {
            // In home stretch
            const newHS = p.homeStretch + G.dice;
            if (newHS <= 5) moves.push({ pieceIdx: i, type: 'homeMove', target: newHS });
            if (newHS === 5) moves[moves.length - 1].type = 'finish';
        } else {
            // On main track
            const startPos = HOME_START[player.color];
            const newPos = (p.pos + G.dice) % BOARD_SIZE;
            // Check if entering home stretch
            const entryPoint = (startPos + BOARD_SIZE - 2) % BOARD_SIZE;
            let dist = (entryPoint - p.pos + BOARD_SIZE) % BOARD_SIZE;
            
            if (G.dice > dist) {
                // Entering home stretch
                const targetHS = G.dice - dist - 1;
                if (targetHS <= 5) {
                    moves.push({ pieceIdx: i, type: targetHS === 5 ? 'finish' : 'homeEnter', target: targetHS });
                }
            } else {
                moves.push({ pieceIdx: i, type: 'move', target: newPos });
            }
        }
    });
    return moves;
}

function movePiece(moveObj) {
    if (G.animating || !G.diceRolled) return;
    const player = G.players[G.currentTurn];
    const piece = player.pieces[moveObj.pieceIdx];
    clearHighlights();
    sfx('move');
    vibrate(30);
    G.totalMoves[player.color]++;

    let captured = false;
    let finished = false;

    if (moveObj.type === 'exit') {
        piece.pos = HOME_START[player.color];
        piece.homeStretch = -1;
        captured = checkCapture(player, piece);
        showToast(`${COLOR_AR[player.color]} خرج قطعة! 🚀`);
    } else if (moveObj.type === 'move') {
        piece.pos = moveObj.target;
        captured = checkCapture(player, piece);
    } else if (moveObj.type === 'homeEnter' || moveObj.type === 'homeMove') {
        piece.homeStretch = moveObj.target;
        piece.pos = -2; // mark as in home stretch
    } else if (moveObj.type === 'finish') {
        piece.finished = true;
        piece.homeStretch = 5;
        piece.pos = -3;
        finished = true;
        G.finishedPieces[player.color]++;
        player.score += 25;
        sfx('home');
        vibrate(100);
        showToast(`🏠 قطعة وصلت البيت! +25 نقطة`);
        showParticles(player.color);
        // Check if all pieces finished
        if (player.pieces.every(p => p.finished)) {
            player.finished = true;
            G.rankings.push(player.color);
            if (G.rankings.length === 1) {
                G.winner = player.color;
                sfx('win');
                showToast(`🏆 ${player.name} (${COLOR_AR[player.color]}) فاز باللعبة!`);
                showWinScreen(player);
            }
            if (G.rankings.length >= G.numPlayers - 1) G.gameOver = true;
        }
    }

    G.moveHistory.push({ color: player.color, dice: G.dice, move: moveObj.type, piece: moveObj.pieceIdx });
    G.diceRolled = false;

    if ((G.dice === 6 || captured || finished) && !G.gameOver && !player.finished) {
        // Play again on 6, capture, or finish
        if (captured) showToast('العب تاني عشان كلت! 🗡️');
        else if (finished && G.dice !== 6) showToast('العب تاني عشان دخلت بيتك! 🏠');
        
        setTimeout(() => { 
            renderBoard(); 
            clearTurnTimer();
            startTurnTimer();
            
            if (player.isBot) {
                if (G.mode === 'online' && !G.isActingHost && !G.isHost) return;
                autoPlay(); 
            }
        }, 600);
    } else {
        nextTurn();
    }
    if (G.mode === 'online') syncState();
    renderBoard();
}

function checkCapture(player, piece) {
    if (SAFE_SPOTS.includes(piece.pos)) return false;
    let didCapture = false;
    G.players.forEach(other => {
        if (other.color === player.color) return;
        
        // Count other player's pieces on this spot
        let piecesOnSpot = 0;
        other.pieces.forEach(op => {
            if (op.pos === piece.pos && op.pos >= 0 && op.homeStretch < 0) {
                piecesOnSpot++;
            }
        });

        // If 2 or more pieces are together, they form a block and are protected
        if (piecesOnSpot >= 2) {
            return; 
        }

        other.pieces.forEach(op => {
            if (op.pos === piece.pos && op.pos >= 0 && op.homeStretch < 0) {
                op.pos = -1;
                op.homeStretch = -1;
                player.score += 10;
                G.captures[player.color]++;
                G.combo++;
                sfx('capture');
                vibrate([50, 50, 100]);
                showToast(`💥 ${COLOR_AR[player.color]} أكل قطعة ${COLOR_AR[other.color]}! +10`);
                showParticles(player.color);
                if (G.combo >= 2) showToast(`🔥 كومبو x${G.combo}! +${G.combo * 5} بونص`);
                player.score += (G.combo - 1) * 5;
                didCapture = true;
            }
        });
    });
    return didCapture;
}

function nextTurn() {
    G.combo = 0;
    clearTurnTimer();
    let next = (G.currentTurn + 1) % G.numPlayers;
    let attempts = 0;
    while (G.players[next] && G.players[next].finished && attempts < G.numPlayers) {
        next = (next + 1) % G.numPlayers;
        attempts++;
    }
    G.currentTurn = next;
    G.diceRolled = false;
    G.sixCount = 0;
    startTurnTimer();
    renderBoard();
    if (G.players[G.currentTurn] && G.players[G.currentTurn].isBot && !G.gameOver) {
        if (G.mode === 'online' && !G.isActingHost && !G.isHost) return;
        setTimeout(autoPlay, 800);
    }
}

// ===== Bot & AutoPlay AI =====
// Uses callback-based dice to avoid race conditions
function autoPlay() {
    if (G.gameOver) return;
    const player = G.players[G.currentTurn];
    if (!player) return;

    if (!G.diceRolled) {
        doRollDice(function (moves) {
            makeAutoMove(moves);
        });
    } else {
        makeAutoMove(G.validMoves || []);
    }
}

function makeAutoMove(moves) {
    const player = G.players[G.currentTurn];
    if (!moves || moves.length === 0) {
        setTimeout(() => { 
            G.diceRolled = false; 
            nextTurn(); 
            if (G.mode === 'online') syncState();
        }, 1000);
        return;
    }

    // AI priority: finish > capture > homeEnter > exit > move furthest
    let best = moves[0];
    let bestScore = -1;

    for (const m of moves) {
        let score = 0;
        if (m.type === 'finish') score = 100;
        else if (m.type === 'homeEnter' || m.type === 'homeMove') score = 60;
        else if (m.type === 'exit') score = 40;
        else if (m.type === 'move') {
            score = 20;
            // Bonus for capturing
            const targetPos = m.target;
            G.players.forEach(other => {
                if (other.color === player.color) return;
                other.pieces.forEach(op => {
                    if (op.pos === targetPos && op.pos >= 0 && !SAFE_SPOTS.includes(targetPos)) {
                        score = 80; // capture is high priority
                    }
                });
            });
            // Bonus for moving to safe spot
            if (SAFE_SPOTS.includes(m.target)) score += 10;
        }
        if (score > bestScore) {
            bestScore = score;
            best = m;
        }
    }

    // Small delay so the move feels natural
    setTimeout(() => {
        movePiece(best);
    }, 400);
}

// ===== Turn Timer =====
function startTurnTimer() {
    // Don't run timer for bot turns
    const player = G.players[G.currentTurn];
    if (player && player.isBot) {
        const el = document.getElementById('turnTimer');
        if (el) el.textContent = '🤖';
        return;
    }
    // In online mode, only show timer if it's my turn
    if (G.mode === 'online' && player && player.color !== G.myColor) {
        const el = document.getElementById('turnTimer');
        if (el) el.textContent = '⏳';
        return;
    }
    G.turnTimeLeft = 30;
    updateTimerUI();
    G.turnTimer = setInterval(() => {
        G.turnTimeLeft--;
        updateTimerUI();
        if (G.turnTimeLeft <= 5 && G.turnTimeLeft > 0) sfx('tick');
        if (G.turnTimeLeft <= 0) {
            clearTurnTimer();
            showToast('⏰ انتهى الوقت! لعب تلقائي...');
            sfx('buzz');
            // In online, restrict who triggers autoPlay strictly
            if (G.mode === 'online') {
                const p = G.players[G.currentTurn];
                if (p && p.isBot) {
                    if (!G.isActingHost && !G.isHost) return; // Only acting host autoPlays bots
                } else {
                    if (p && p.color !== G.myColor) return; // Only you can autoPlay yourself
                }
            }
            autoPlay();
        }
    }, 1000);
}
function clearTurnTimer() { if (G.turnTimer) { clearInterval(G.turnTimer); G.turnTimer = null; } }
function updateTimerUI() {
    const el = document.getElementById('turnTimer');
    if (el) el.textContent = G.turnTimeLeft + 's';
}

// ===== Highlights =====
function highlightMoves(moves) {
    moves.forEach(m => {
        const el = document.querySelector(`[data-piece="${G.currentTurn}-${m.pieceIdx}"]`);
        if (el) el.classList.add('highlight-piece');
    });
    // Store valid moves for click handling
    G.validMoves = moves;
}
function clearHighlights() {
    document.querySelectorAll('.highlight-piece').forEach(el => el.classList.remove('highlight-piece'));
    G.validMoves = [];
}

// ===== Rendering =====
function renderBoard() {
    const board = document.getElementById('ludoBoard');
    if (!board) return;
    const W = board.width, H = board.height;
    // If canvas has no size yet, try to resize and skip this frame
    if (W === 0 || H === 0) {
        resizeCanvas();
        return;
    }
    const ctx = board.getContext('2d');
    // Use CSS size for drawing coordinates (ctx is already scaled by DPR)
    const cssSize = parseFloat(board.style.width) || (W / (window.devicePixelRatio || 1));
    const cell = cssSize / 15;
    ctx.clearRect(0, 0, cssSize, cssSize);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, cssSize, cssSize);

    // Draw colored bases (6x6 cells each corner)
    drawBase(ctx, 0, 0, cell * 6, cell * 6, '#ef4444', '#b91c1c', '#fca5a5');       // red top-left
    drawBase(ctx, cell * 9, 0, cell * 6, cell * 6, '#3b82f6', '#1d4ed8', '#93c5fd'); // blue top-right
    drawBase(ctx, cell * 9, cell * 9, cell * 6, cell * 6, '#eab308', '#a16207', '#fde047'); // yellow bottom-right
    drawBase(ctx, 0, cell * 9, cell * 6, cell * 6, '#22c55e', '#15803d', '#86efac'); // green bottom-left

    // Draw main track
    drawTrack(ctx, cell);

    // Draw home stretches
    drawHomeStretches(ctx, cell);

    // Center home triangle
    drawCenter(ctx, cell);

    // Draw safe spots star markers
    SAFE_SPOTS.forEach(i => {
        if (i < PATH_COORDS.length) {
            const [cx, cy] = PATH_COORDS[i];
            const sx = cx * cell + cell / 2, sy = cy * cell + cell / 2;
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = `${cell * 0.4}px Cairo`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('⭐', sx, sy);
        }
    });

    // Draw pieces
    const cellMap = {};
    G.players.forEach((player, pi) => {
        player.pieces.forEach((piece, i) => {
            let key = piece.finished ? `fin_${pi}` : (piece.pos === -1 ? `base_${pi}_${i}` : (piece.homeStretch >= 0 ? `hs_${player.color}_${piece.homeStretch}` : `trk_${piece.pos}`));
            if (!cellMap[key]) cellMap[key] = [];
            cellMap[key].push({ player, pi, piece, i });
        });
    });

    for (const [key, list] of Object.entries(cellMap)) {
        const len = list.length;
        list.forEach((item, idx) => {
            const { player, pi, piece, i } = item;
            let x, y;
            if (piece.finished) {
                const angle = (pi * Math.PI / 2) + (i * 0.4) - 0.3;
                x = 7.5 * cell + Math.cos(angle) * cell * 0.7;
                y = 7.5 * cell + Math.sin(angle) * cell * 0.7;
            } else if (piece.pos === -1) {
                const bc = BASE_COORDS[player.color][i];
                x = bc[0] * cell + cell / 2;
                y = bc[1] * cell + cell / 2;
            } else if (piece.homeStretch >= 0) {
                const hc = HOME_STRETCH_COORDS[player.color][piece.homeStretch];
                if (hc) { x = hc[0] * cell + cell / 2; y = hc[1] * cell + cell / 2; }
            } else if (piece.pos >= 0 && piece.pos < PATH_COORDS.length) {
                const pc = PATH_COORDS[piece.pos];
                x = pc[0] * cell + cell / 2;
                y = pc[1] * cell + cell / 2;
            }
            if (x !== undefined) {
                let ox = 0, oy = 0;
                let pRadius = cell * 0.32;
                // Better stacking inside squares
                if (!key.startsWith('base') && !key.startsWith('fin') && len > 1) {
                    pRadius = cell * 0.25;
                    const maxCols = Math.ceil(Math.sqrt(len));
                    const row = Math.floor(idx / maxCols);
                    const col = idx % maxCols;
                    const step = cell * 0.35;
                    ox = (col - (maxCols - 1) / 2) * step;
                    oy = (row - (Math.ceil(len / maxCols) - 1) / 2) * step;
                }
                drawPiece(ctx, x + ox, y + oy, pRadius, COLOR_HEX[player.color],
                    G.validMoves && G.validMoves.some(m => m.pieceIdx === i) && pi === G.currentTurn);
            }
        });
    }

    updateScoreboard();
    updateDiceUI();
}

function drawBase(ctx, x, y, w, h, color, darkColor, lightColor) {
    // Outer border glow
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 14);
    ctx.fill();
    // Inner colored area
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, darkColor);
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 3, w - 6, h - 6, 12);
    ctx.fill();
    // Inner box for pieces (dark rounded)
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(x + w * 0.18, y + h * 0.18, w * 0.64, h * 0.64, 10);
    ctx.fill();
    // Subtle inner glow
    ctx.strokeStyle = color + '66';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x + w * 0.18, y + h * 0.18, w * 0.64, h * 0.64, 10);
    ctx.stroke();
}

function drawCenter(ctx, cell) {
    const cx = 7.5 * cell, cy = 7.5 * cell, s = cell * 1.5;
    // Background circle
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.95, 0, Math.PI * 2);
    ctx.fill();
    // Four colored triangles pointing to center
    const triangles = [
        { c: '#ef4444', points: [[6, 6], [6, 9], [7.5, 7.5]] },   // from left (red)
        { c: '#3b82f6', points: [[6, 6], [9, 6], [7.5, 7.5]] },   // from top (blue)
        { c: '#eab308', points: [[9, 6], [9, 9], [7.5, 7.5]] },    // from right (yellow)
        { c: '#22c55e', points: [[6, 9], [9, 9], [7.5, 7.5]] }     // from bottom (green)
    ];
    triangles.forEach(t => {
        ctx.fillStyle = t.c;
        ctx.beginPath();
        ctx.moveTo(t.points[0][0] * cell, t.points[0][1] * cell);
        ctx.lineTo(t.points[1][0] * cell, t.points[1][1] * cell);
        ctx.lineTo(t.points[2][0] * cell, t.points[2][1] * cell);
        ctx.closePath();
        ctx.fill();
    });
    // Center white circle
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = `bold ${cell * 0.35}px Cairo`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏠', cx, cy);
}

function drawTrack(ctx, cell) {
    PATH_COORDS.forEach((c, i) => {
        const x = c[0] * cell, y = c[1] * cell;
        // White track cell
        ctx.fillStyle = '#e2e8f0';
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, cell - 2, cell - 2, 3);
        ctx.fill();
        ctx.stroke();

        // Color start positions with a colored fill
        const starts = [
            { idx: HOME_START.red, color: '#ef4444' },
            { idx: HOME_START.blue, color: '#3b82f6' },
            { idx: HOME_START.yellow, color: '#eab308' },
            { idx: HOME_START.green, color: '#22c55e' }
        ];
        starts.forEach(s => {
            if (i === s.idx) {
                ctx.fillStyle = s.color;
                ctx.beginPath();
                ctx.roundRect(x + 1, y + 1, cell - 2, cell - 2, 3);
                ctx.fill();
                // Arrow/star marker
                ctx.fillStyle = '#ffffff';
                ctx.font = `${cell * 0.4}px Cairo`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('▶', x + cell / 2, y + cell / 2);
            }
        });

        // Safe spots get a subtle highlight
        if (SAFE_SPOTS.includes(i) && ![HOME_START.red, HOME_START.blue, HOME_START.green, HOME_START.yellow].includes(i)) {
            ctx.fillStyle = 'rgba(251,191,36,0.15)';
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, cell - 2, cell - 2, 3);
            ctx.fill();
        }
    });
}

function drawHomeStretches(ctx, cell) {
    Object.entries(HOME_STRETCH_COORDS).forEach(([color, coords]) => {
        coords.forEach((c, idx) => {
            const x = c[0] * cell, y = c[1] * cell;
            // Gradient from lighter at start to darker near center
            const alpha = 0.5 + (idx * 0.08);
            ctx.fillStyle = COLOR_HEX[color];
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.roundRect(x + 1, y + 1, cell - 2, cell - 2, 3);
            ctx.fill();
            ctx.globalAlpha = 1;
            // Border
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1;
            ctx.stroke();
        });
    });
}

function drawPiece(ctx, x, y, r, color, isHighlighted) {
    if (isHighlighted) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 15;
        // Pulse effect
        const pulse = Math.sin(Date.now() / 200) * 0.15 + 1;
        r *= pulse;
    }
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(x + 2, y + 2, r, 0, Math.PI * 2);
    ctx.fill();
    // Main
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    grad.addColorStop(0, 'white');
    grad.addColorStop(0.3, color);
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
}

// ===== UI Updates =====
function updateScoreboard() {
    G.players.forEach((p, i) => {
        const el = document.getElementById(`score-${p.color}`);
        if (el) {
            el.querySelector('.s-name').textContent = p.name;
            el.querySelector('.s-score').textContent = p.score;
            el.querySelector('.s-pieces').textContent = `${G.finishedPieces[p.color]}/4`;
            el.classList.toggle('active-turn', i === G.currentTurn);
        }
    });
}

function updateDiceUI() {
    const el = document.getElementById('currentTurnLabel');
    if (el) {
        const p = G.players[G.currentTurn];
        if (p) {
            el.textContent = `دور: ${p.name || 'لاعب'}`;
            el.style.color = COLOR_HEX[p.color] || '#fff';
        } else {
            el.textContent = `دور: ---`;
            el.style.color = '#fff';
        }
    }
    
    const diceEl = document.getElementById('dice');
    if (diceEl && !G.animating && G.dice >= 1 && G.dice <= 6) {
        diceEl.innerHTML = DICE_SVGS[G.dice - 1];
        diceEl.style.color = '#000';
        diceEl.style.fontSize = 'initial';
    }
}

// ===== Toast & Effects =====
function showToast(msg) {
    const container = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast-msg';
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

function showParticles(color) {
    const canvas = document.getElementById('particles');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const particles = [];
    for (let i = 0; i < 30; i++) {
        particles.push({
            x: canvas.width / 2, y: canvas.height / 2,
            vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8,
            r: Math.random() * 4 + 2, color: COLOR_HEX[color], life: 1
        });
    }
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        particles.forEach(p => {
            if (p.life <= 0) return;
            alive = true;
            p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.life -= 0.02;
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = 1;
        if (alive) requestAnimationFrame(animate);
    }
    animate();
}

function showWinScreen(player) {
    const overlay = document.getElementById('winOverlay');
    overlay.style.display = 'flex';
    document.getElementById('winnerName').textContent = player.name + ' فاز!';
    document.getElementById('winnerName').style.color = COLOR_HEX[player.color];

    const tbody = document.getElementById('winTableBody');
    tbody.innerHTML = '';
    
    G.players.forEach((p) => {
        let rankStr = '-';
        if (p.finished) {
             const rank = G.rankings.indexOf(p.color) + 1;
             rankStr = rank === 1 ? '🥇 الأول' : (rank === 2 ? '🥈 الثاني' : (rank === 3 ? '🥉 الثالث' : 'الرابع'));
        } else if (G.gameOver) {
             rankStr = 'خسر';
        }
        tbody.innerHTML += `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.1); font-weight:bold;">
                <td style="padding:12px;text-align:right;"><span style="color:${COLOR_HEX[p.color]};font-size:1.2rem;vertical-align:middle;">●</span> ${p.name}</td>
                <td style="padding:8px;text-align:center;">${p.score}</td>
                <td style="padding:8px;text-align:center;">${G.captures[p.color]}</td>
                <td style="padding:8px;text-align:center;">${rankStr}</td>
            </tr>
        `;
    });

    sfx('win');
    vibrate([200, 100, 200, 100, 400]);
    for (let i = 0; i < 50; i++) {
        const c = document.createElement('div');
        c.className = 'confetti';
        c.style.left = Math.random() * 100 + 'vw';
        c.style.background = COLOR_HEX[COLORS[Math.floor(Math.random() * 4)]];
        c.style.animationDuration = Math.random() * 2 + 2 + 's';
        overlay.appendChild(c);
        setTimeout(() => c.remove(), 4000);
    }
}

// ===== Click Handler =====
function handleBoardClick(e) {
    if (!G.diceRolled || G.animating || G.gameOver) return;
    const player = G.players[G.currentTurn];
    if (player.isBot) return;
    // Online: only the correct player can move (use color for reliable sync)
    if (G.mode === 'online' && player.color !== G.myColor) return;

    const canvas = document.getElementById('ludoBoard');
    const rect = canvas.getBoundingClientRect();
    // Use CSS coordinates (same as rendering coordinates)
    const mx = (e.clientX - rect.left) * (parseFloat(canvas.style.width) || rect.width) / rect.width;
    const my = (e.clientY - rect.top) * (parseFloat(canvas.style.height) || rect.height) / rect.height;
    const cell = (parseFloat(canvas.style.width) || rect.width) / 15;

    if (!G.validMoves || G.validMoves.length === 0) return;

    // Find clicked piece
    let clicked = null;
    G.validMoves.forEach(m => {
        const piece = player.pieces[m.pieceIdx];
        let px, py;
        if (piece.pos === -1) {
            const bc = BASE_COORDS[player.color][m.pieceIdx];
            px = bc[0] * cell; py = bc[1] * cell;
        } else if (piece.homeStretch >= 0) {
            const hc = HOME_STRETCH_COORDS[player.color][piece.homeStretch];
            if (hc) { px = hc[0] * cell + cell / 2; py = hc[1] * cell + cell / 2; }
        } else if (piece.pos >= 0) {
            const pc = PATH_COORDS[piece.pos];
            px = pc[0] * cell + cell / 2; py = pc[1] * cell + cell / 2;
        }
        if (px !== undefined) {
            const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
            if (dist < cell * 0.6) clicked = m;
        }
    });

    if (clicked) movePiece(clicked);
}

// ===== Online Sync =====
// Sequence number to prevent stale state from overwriting newer state
let _syncSeq = 0;

function syncState() {
    if (G.mode !== 'online' || !G.roomId) return;
    _syncSeq++;
    
    // Build explicit piece states for each color
    let piecesPayload = {};
    G.players.forEach(p => {
        piecesPayload[`${p.color}Pieces`] = p.pieces;
    });

    db.ref('ludo_rooms/' + G.roomId + '/state').set({
        players: G.players,
        currentTurn: G.currentTurn,
        dice: G.dice,
        diceRolled: G.diceRolled,
        rankings: G.rankings || [],
        gameOver: G.gameOver,
        sixCount: G.sixCount,
        seq: _syncSeq,
        updatedBy: G.mySlotId || '',
        
        // --- Explicit fields for direct synchronization ---
        activePlayerTurnNumber: G.currentTurn + 1,
        activePlayerColor: G.players[G.currentTurn] ? G.players[G.currentTurn].color : '',
        ...piecesPayload
    });
}

// Track the last sequence number we processed to ignore stale/own updates
let _lastReceivedSeq = -1;
let _botAutoPlayScheduled = false;

function listenOnline() {
    db.ref('ludo_rooms/' + G.roomId + '/state').on('value', snap => {
        const data = snap.val();
        if (!data || !data.players) return;

        const incomingSeq = data.seq || 0;

        // If this update was sent by us, skip reprocessing (we already have the state)
        // CRITICAL FIX: Only skip if G.players is already populated, otherwise the Host ignores the very first initialization!
        if (data.updatedBy === G.mySlotId && incomingSeq <= _syncSeq && G.players && G.players.length > 0) {
            return;
        }

        if (incomingSeq > _syncSeq) _syncSeq = incomingSeq;

        // Track sequence
        _lastReceivedSeq = incomingSeq;

        const prevTurn = G.currentTurn;

        // Apply the full authoritative state from Firebase
        G.players = Array.isArray(data.players) ? data.players : Object.values(data.players);
        
        // Sync pieces explicitly from the new fields 
        G.players.forEach(p => {
             const explicitPieces = data[`${p.color}Pieces`];
             if (explicitPieces) {
                 p.pieces = Array.isArray(explicitPieces) ? explicitPieces : Object.values(explicitPieces);
             }
             // Ultimate deep safety net to guarantee it's a safe Array of 4 elements
             const rawPieces = p.pieces || {};
             p.pieces = [0, 1, 2, 3].map(i => {
                 const rp = rawPieces[i] || {};
                 return {
                     pos: rp.pos !== undefined ? rp.pos : -1,
                     homeStretch: rp.homeStretch !== undefined ? rp.homeStretch : -1,
                     finished: rp.finished || false
                 };
             });
        });

        G.currentTurn = data.currentTurn;
        G.dice = data.dice;
        G.diceRolled = data.diceRolled;  // Trust the synced value
        G.rankings = data.rankings || [];
        G.gameOver = data.gameOver;
        G.sixCount = data.sixCount || 0;
        G.numPlayers = data.players.length;

        // Detect myColor from slotId
        if (!G.myColor && G.mySlotId) {
            const me = G.players.find(p => p.slotId === G.mySlotId);
            if (me) G.myColor = me.color;
        }

        // Update stats dicts
        G.players.forEach(p => {
            if (G.totalMoves[p.color] === undefined) G.totalMoves[p.color] = 0;
            if (G.captures[p.color] === undefined) G.captures[p.color] = 0;
            if (G.finishedPieces[p.color] === undefined) G.finishedPieces[p.color] = 0;
            if (G.streakSixes[p.color] === undefined) G.streakSixes[p.color] = 0;
        });

        // If sequence changed, reset local timer for tight synchronization
        if (incomingSeq > _lastReceivedSeq) {
            clearTurnTimer();
            startTurnTimer();
        }

        // If it's now a bot's turn and I'm the host, auto-play (with guard against duplicates)
        const curPlayer = G.players[G.currentTurn];
        if ((G.isActingHost || G.isHost) && curPlayer && curPlayer.isBot && !G.gameOver && !_botAutoPlayScheduled) {
            _botAutoPlayScheduled = true;
            setTimeout(() => {
                _botAutoPlayScheduled = false;
                if (G.players[G.currentTurn] && G.players[G.currentTurn].isBot && !G.gameOver) {
                    autoPlay();
                }
            }, 800);
        }

        renderBoard();
        updateDiceUI();
    });
}

// ===== Chat =====
function initChat() {
    const chatRef = db.ref(`ludo_rooms/${G.roomId}/chat`);
    chatRef.limitToLast(50).on('child_added', snap => {
        const msg = snap.val();
        appendChat(msg.sender, msg.text, msg.sender === G.myName);
        if (!G.chatOpen) document.getElementById('chatDot2').style.display = 'block';
    });
}
function sendChatMsg() {
    const input = document.getElementById('ludoChatInput');
    const text = input.value.trim();
    if (!text) return;
    if (G.mode === 'online') {
        db.ref(`ludo_rooms/${G.roomId}/chat`).push({ sender: G.myName, text, time: firebase.database.ServerValue.TIMESTAMP });
    } else {
        appendChat(G.myName, text, true);
        if(!G.chatOpen) document.getElementById('chatDot2').style.display = 'block';
        if (G.mode === 'bot' && Math.random() > 0.3) {
            setTimeout(() => {
                const replies = ['جميل!', 'حظ موفق', 'سنرى من سيفوز 🤖', 'لن تستطيع هزيمتي!'];
                appendChat('البوت', replies[Math.floor(Math.random() * replies.length)], false);
                if(!G.chatOpen) document.getElementById('chatDot2').style.display = 'block';
            }, 1000 + Math.random() * 1000);
        }
    }
    input.value = '';
}
function sendEmoji(emoji) {
    if (G.mode === 'online') {
        db.ref(`ludo_rooms/${G.roomId}/chat`).push({ sender: G.myName, text: emoji, time: firebase.database.ServerValue.TIMESTAMP });
    } else {
        appendChat(G.myName, emoji, true);
        if(!G.chatOpen) document.getElementById('chatDot2').style.display = 'block';
        if (G.mode === 'bot' && Math.random() > 0.5) {
            setTimeout(() => {
                const replies = ['🤖', '😂', '🤔', '😡', '😎'];
                appendChat('البوت', replies[Math.floor(Math.random() * replies.length)], false);
                if(!G.chatOpen) document.getElementById('chatDot2').style.display = 'block';
            }, 1000 + Math.random() * 1000);
        }
    }
}
function appendChat(sender, text, isMine) {
    const box = document.getElementById('ludoChatHistory');
    const d = document.createElement('div');
    d.className = 'chat-msg' + (isMine ? ' mine' : '');
    d.innerHTML = `<span class="sender-name">${sender}</span>${text}`;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
}
function toggleLudoChat() {
    G.chatOpen = !G.chatOpen;
    document.getElementById('ludoChatBox').style.display = G.chatOpen ? 'flex' : 'none';
    if (G.chatOpen) document.getElementById('chatDot2').style.display = 'none';
}

// ===== Animation Loop =====
let animFrame;
function gameLoop() {
    renderBoard();
    animFrame = requestAnimationFrame(gameLoop);
}

// ===== Start Functions =====
function startBotGame() {
    G.myName = localStorage.getItem('heka_global_player_name') || localStorage.getItem('heka_player_name') || 'لاعب';
    initGame('bot', selectedPlayers);
    document.getElementById('botSetup').style.display = 'none';
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'flex';
    // Hide chat entirely in bot mode
    document.getElementById('chatTrigger2').style.display = 'none';
    // Wait a frame for the container to be visible, then resize canvas and start
    requestAnimationFrame(() => {
        resizeCanvas();
        startTurnTimer();
        gameLoop();
    });
}
function startOnlineGame() {
    document.getElementById('onlineLobby').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'flex';
    document.getElementById('chatTrigger2').style.display = 'flex';
    G.mode = 'online';

    // Detect myColor from slotId
    db.ref(`ludo_rooms/${G.roomId}/state/players`).once('value', snap => {
        let players = snap.val();
        if (players) {
            if (!Array.isArray(players)) players = Object.values(players);
            const me = players.find(p => p.slotId === G.mySlotId);
            if (me) G.myColor = me.color;
        }
    });

    // Disconnect handling - use slotId as the key for presence (unique per player)
    const presenceKey = G.mySlotId || G.myName;
    G.myPresenceRef = db.ref(`ludo_rooms/${G.roomId}/presence/${presenceKey}`);
    
    // Auto-reconnect presence logic natively supported by Firebase
    db.ref('.info/connected').on('value', snap => {
        if (snap.val() === true) {
            G.myPresenceRef.set({ name: G.myName, slotId: G.mySlotId });
            G.myPresenceRef.onDisconnect().remove();
        }
    });

    db.ref(`ludo_rooms/${G.roomId}/presence`).on('value', snap => {
        if (!G.players) return;
        const pres = snap.val() || {};
        const presentSlotIds = Object.values(pres).map(v => v.slotId || v);

        // Determine acting host (first connected player)
        let actingHostSlot = null;
        for (let p of G.players) {
             if (presentSlotIds.includes(p.slotId) || p.slotId === G.mySlotId) {
                 actingHostSlot = p.slotId;
                 break;
             }
        }
        G.isActingHost = (actingHostSlot === G.mySlotId) || G.isHost;

        if (!G.isActingHost) return;

        let changed = false;
        G.players.forEach(p => {
             // Mark disconnected human players as bots
             if (!p.isBot && p.slotId !== G.mySlotId && !presentSlotIds.includes(p.slotId)) {
                 p.isBot = true;
                 p._originalName = p._originalName || p.name;
                 p._originalSlotId = p._originalSlotId || p.slotId;
                 changed = true;
                 showToast(`🔴 ${p.name || 'لاعب'} غادر اللعبة! بيلعب مكانه البوت`);
             }
             // Rejoin: if a bot has the original slotId of a present player, restore them
             if (p.isBot && p._originalSlotId && presentSlotIds.includes(p._originalSlotId)) {
                 p.isBot = false;
                 p.name = p._originalName || p.name;
                 changed = true;
                 showToast(`🟢 ${p.name || 'لاعب'} رجع للعبة!`);
             }
        });
        if (changed) syncState();
    });

    listenOnline();
    initChat();
    // Wait a frame for the container to be visible, then resize canvas and start
    requestAnimationFrame(() => {
        resizeCanvas();
        startTurnTimer();
        gameLoop();
    });
}

// ===== Auto-cleanup rooms older than 2 hours =====
function cleanupOldRooms() {
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    db.ref('ludo_rooms').orderByChild('createdAt').endAt(twoHoursAgo).once('value', snap => {
        const rooms = snap.val();
        if (!rooms) return;
        Object.keys(rooms).forEach(roomId => {
            db.ref('ludo_rooms/' + roomId).remove();
        });
    });
}

// Generate a random 4-digit room code
function generateRoomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

// Create a new room (auto-generate 4-digit code, retry if taken)
function createRoom() {
    G.myName = localStorage.getItem('heka_global_player_name') || localStorage.getItem('heka_player_name') || 'لاعب';
    
    // Cleanup old rooms first
    cleanupOldRooms();

    // Generate a unique slot ID for this player
    G.mySlotId = 'slot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    const roomCode = generateRoomCode();
    G.roomId = roomCode;
    G.isHost = true;

    // Check if code already exists, if so regenerate
    db.ref(`ludo_rooms/${G.roomId}`).once('value', snap => {
        if (snap.exists()) {
            // Try again with a different code
            G.roomId = generateRoomCode();
        }
        // Create the room in Firebase
        db.ref(`ludo_rooms/${G.roomId}`).set({
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            host: G.myName,
            hostSlotId: G.mySlotId,
            gameStarted: false
        }).then(() => {
            _enterLobby();
        });
    });
}

function joinLobby() {
    G.myName = localStorage.getItem('heka_global_player_name') || localStorage.getItem('heka_player_name') || 'لاعب';
    G.roomId = document.getElementById('ludoRoomInput').value.trim();
    if (!G.roomId) { alert('اكتب كود الغرفة!'); return; }
    
    // Cleanup old rooms
    cleanupOldRooms();

    // Generate a unique slot ID for this player
    G.mySlotId = 'slot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    // Check if room exists
    db.ref(`ludo_rooms/${G.roomId}`).once('value', snap => {
        if (!snap.exists()) {
            alert('الغرفة مش موجودة! تأكد من الكود 🚫');
            return;
        }

        // Check if game already started — try to rejoin or block
        const roomData = snap.val();
        if (roomData.gameStarted) {
            db.ref(`ludo_rooms/${G.roomId}/state/players`).once('value', stateSnap => {
                const players = stateSnap.val();
                if (!players) { alert('الغرفة مشغولة! اللعبة بدأت بالفعل 🚫'); return; }
                // Try to find our slot by name or originalName
                const mySlot = players.find(p => p._originalName === G.myName || p.name === G.myName);
                if (mySlot) {
                    showToast('🟢 بترجع للعبة...');
                    G.mySlotId = mySlot.slotId;
                    G.myColor = mySlot.color;
                    G.isHost = false;
                    document.getElementById('onlineSetup').style.display = 'none';
                    const rejoinRef = db.ref(`ludo_rooms/${G.roomId}/presence/${G.mySlotId}`);
                    rejoinRef.set({ name: G.myName, slotId: G.mySlotId });
                    rejoinRef.onDisconnect().remove();
                    G.myPresenceRef = rejoinRef;
                    startOnlineGame();
                } else {
                    alert('الغرفة مشغولة! اللعبة بدأت بالفعل 🚫');
                }
            });
            return;
        }

        // Game not started yet — join lobby normally
        G.isHost = false;
        _enterLobby();
    });
}

function _enterLobby() {
    document.getElementById('onlineSetup').style.display = 'none';
    document.getElementById('onlineLobby').style.display = 'block';
    document.getElementById('lobbyRoomId').textContent = G.roomId;

    // Use slotId as the lobby key to guarantee uniqueness
    G.lobbyRef = db.ref(`ludo_rooms/${G.roomId}/lobby/${G.mySlotId}`);
    G.lobbyRef.set({ name: G.myName, slotId: G.mySlotId });
    G.lobbyRef.onDisconnect().remove();

    // Read host slotId from room
    db.ref(`ludo_rooms/${G.roomId}/hostSlotId`).once('value', snap => {
        const hostSlotId = snap.val();
        
        db.ref(`ludo_rooms/${G.roomId}/lobby`).on('value', snap2 => {
            const players = snap2.val() || {};
            const keys = Object.keys(players);
            const ul = document.getElementById('lobbyPlayersList');
            ul.innerHTML = '';
            keys.forEach((k, i) => {
                const pData = players[k];
                const displayName = pData.name || k;
                const isHost = (k === hostSlotId);
                ul.innerHTML += `<li style="padding:10px; background:rgba(255,255,255,0.1); margin-top:5px; border-radius:10px;">👤 ${displayName} ${isHost?'👑 (المضيف)':''}</li>`;
                if (k === G.mySlotId) G.isHost = isHost;
            });
            // Only show start button for the host, and need at least 2 players
            document.getElementById('btnStartOnline').style.display = G.isHost && keys.length >= 2 ? 'inline-block' : 'none';
        });
    });

    db.ref(`ludo_rooms/${G.roomId}/gameStarted`).on('value', snap3 => {
        if (snap3.val()) {
            db.ref(`ludo_rooms/${G.roomId}/gameStarted`).off();
            db.ref(`ludo_rooms/${G.roomId}/lobby`).off();
            startOnlineGame();
        }
    });
}

function startGameFromLobby() {
    if (!G.isHost) return; // Only host can start
    db.ref(`ludo_rooms/${G.roomId}/lobby`).once('value', snap => {
         const pObj = snap.val() || {};
         const pKeys = Object.keys(pObj); // these are slotIds
         const numOnlinePlayers = pKeys.length || 1;
         
         const players = [];
         let playColors = COLORS.slice(0, numOnlinePlayers);
         if (numOnlinePlayers === 2) playColors = ['blue', 'green'];

         for (let i = 0; i < numOnlinePlayers; i++) {
             const color = playColors[i];
             const slotId = pKeys[i];
             const pData = pObj[slotId];
             const name = pData ? pData.name : `Bot ${i+1}`;
             const isBot = !pData;
             players.push({
                 color, name, isBot,
                 slotId: slotId,
                 _originalName: name,
                 pieces: [{ pos: -1, homeStretch: -1, finished: false }, { pos: -1, homeStretch: -1, finished: false }, { pos: -1, homeStretch: -1, finished: false }, { pos: -1, homeStretch: -1, finished: false }],
                 score: 0, finished: false
             });
         }

         // Set host myColor right away using slotId
         const hostPlayer = players.find(p => p.slotId === G.mySlotId);
         if (hostPlayer) G.myColor = hostPlayer.color;

         _syncSeq = 1;
         
         // Build explicit piece states for each color
         let piecesPayload = {};
         players.forEach(p => {
             piecesPayload[`${p.color}Pieces`] = p.pieces;
         });

         db.ref(`ludo_rooms/${G.roomId}/state`).set({
             players, currentTurn: 0, dice: 1, diceRolled: false, gameOver: false, sixCount: 0,
             rankings: [], seq: 1, updatedBy: G.mySlotId,
             
             // --- Explicit fields for direct synchronization ---
             activePlayerTurnNumber: 1,
             activePlayerColor: players[0] ? players[0].color : '',
             ...piecesPayload
         }).then(() => {
             db.ref(`ludo_rooms/${G.roomId}/gameStarted`).set(true);
         });
    });
}

function leaveLobby() {
    if (G.lobbyRef) G.lobbyRef.remove();
    // If host leaves, remove the room
    if (G.isHost && G.roomId) {
        db.ref(`ludo_rooms/${G.roomId}`).remove();
    }
    G.mySlotId = null;
    document.getElementById('onlineLobby').style.display = 'none';
    document.getElementById('mainMenu').style.display = 'block';
}

function restartGame() {
    cancelAnimationFrame(animFrame);
    clearTurnTimer();
    // Close audio context to stop all sounds
    if (G._audioCtx) {
        try { G._audioCtx.close(); } catch(e) {}
        G._audioCtx = null;
    }
    // Stop all Firebase listeners and remove presence
    if (G.roomId) {
        db.ref('ludo_rooms/' + G.roomId + '/state').off();
        db.ref('ludo_rooms/' + G.roomId + '/presence').off();
        db.ref('ludo_rooms/' + G.roomId + '/chat').off();
        db.ref('ludo_rooms/' + G.roomId + '/gameStarted').off();
        db.ref('ludo_rooms/' + G.roomId + '/lobby').off();
        if (G.myPresenceRef) G.myPresenceRef.remove();
    }
    // Stop sound
    G.soundOn = false;
    // Reset state
    G.players = [];
    G.roomId = '';
    G.mode = null;
    G.myColor = null;
    G.diceRolled = false;
    G.gameOver = false;
    G.validMoves = [];
    G.animating = false;
    document.getElementById('winOverlay').style.display = 'none';
    document.getElementById('winOverlay').querySelectorAll('.confetti').forEach(c => c.remove());
    document.getElementById('gameContainer').style.display = 'none';
    document.getElementById('mainMenu').style.display = 'block';
    document.getElementById('onlineSetup').style.display = 'none';
    document.getElementById('onlineLobby').style.display = 'none';
    // Reset sound to on for next game
    G.soundOn = true;
    document.getElementById('soundBtn').textContent = '🔊';
}

function showOnlineSetup() {
    document.getElementById('mainMenu').style.display = 'none';
    document.getElementById('onlineSetup').style.display = 'block';
}

// Canvas resize — updates BOTH CSS size and internal canvas resolution
function resizeCanvas() {
    const canvas = document.getElementById('ludoBoard');
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container || container.offsetWidth === 0) return;
    const size = Math.min(container.offsetWidth, 600);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    // Set internal resolution for sharp rendering on high-DPI screens
    // Note: setting canvas.width resets the context transform, so scale won't stack
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Re-render after resize
    if (G.players && G.players.length > 0) renderBoard();
}
window.addEventListener('resize', resizeCanvas);

// Toggle sound
function toggleSound() {
    G.soundOn = !G.soundOn;
    document.getElementById('soundBtn').textContent = G.soundOn ? '🔊' : '🔇';
}
