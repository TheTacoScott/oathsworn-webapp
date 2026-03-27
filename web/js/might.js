/**
 * might.js - Might Deck logic and UI for the Oathsworn web app.
 *
 * All card interaction lives here; main.js only calls openMightOverlay() /
 * closeMightOverlay() and wires the trigger buttons.
 *
 * TABLE OF CONTENTS  (Ctrl+F the [TAG] to jump to each section)
 *
 *   [MIGHT_CONSTANTS]   deck defs, color configs, key helpers
 *   [MIGHT_DECK_CLASS]  MightDeck: shuffle, stage/unstage, reset
 *   [MIGHT_STATE]       8 global deck instances
 *   [MIGHT_DRAW]        mightDrawRound(): full draw with auto-chain
 *   [MIGHT_SVG]         buildIsoCubeSVG()
 *   [MIGHT_RENDER]      HTML builders for overlay, deck rows, cards
 *   [MIGHT_UPDATE]      DOM update helpers
 *   [MIGHT_EVENTS]      event handlers: stage, unstage, draw, reset
 *   [MIGHT_INIT]        initMightUI()
 *   [MIGHT_API]         openMightOverlay(), closeMightOverlay()
 */

//
// ============================================================================
//  [MIGHT_CONSTANTS]
// ============================================================================
//

const MIGHT_DECK_DEFS = {
    white:  ['0','0','0','0','0','0','1','1','1','1','1','1','2','2','2','(2)','(2)','(2)'],
    yellow: ['0','0','0','0','0','0','1','1','1','2','2','2','3','3','3','(3)','(3)','(3)'],
    red:    ['0','0','0','0','0','0','2','2','2','3','3','3','3','3','3','(4)','(4)','(4)'],
    black:  ['0','0','0','0','0','0','3','3','3','3','3','3','4','4','4','(5)','(5)','(5)'],
};

const MIGHT_COLOR_CFG = {
    white: {
        label:      'White',
        cubeTop:    '#c8c0b0', cubeRight: '#908880', cubeLeft: '#686058',
        cardBg:     '#2c2820', cardBorder: '#706858', cardText: '#ddd8c8',
        critGlow:   '#ffee88',
    },
    yellow: {
        label:      'Yellow',
        cubeTop:    '#c8a028', cubeRight: '#906810', cubeLeft: '#604408',
        cardBg:     '#282008', cardBorder: '#907828', cardText: '#e8d058',
        critGlow:   '#ffe020',
    },
    red: {
        label:      'Red',
        cubeTop:    '#902020', cubeRight: '#5c0808', cubeLeft: '#3c0404',
        cardBg:     '#240808', cardBorder: '#803030', cardText: '#e87070',
        critGlow:   '#ff5050',
    },
    black: {
        label:      'Black',
        cubeTop:    '#383858', cubeRight: '#181828', cubeLeft: '#0c0c18',
        cardBg:     '#0e0e1c', cardBorder: '#484868', cardText: '#9088c0',
        critGlow:   '#b080f8',
    },
};

const MIGHT_SIDES  = ['player', 'monster'];
const MIGHT_COLORS = ['white', 'yellow', 'red', 'black'];
const MIGHT_DECK_SIZE = 18;

function mightKey(side, color) { return `${side}_${color}`; }
function isMightCritical(value) { return value.charAt(0) === '('; }
function parseMightValue(value) {
    return isMightCritical(value) ? parseInt(value.slice(1, -1)) : parseInt(value);
}

//
// ============================================================================
//  [MIGHT_DECK_CLASS]
// ============================================================================
//

class MightDeck {
    constructor(color, side) {
        this.color  = color;
        this.side   = side;
        this.remaining   = [...MIGHT_DECK_DEFS[color]];
        this.discarded   = [];
        this.staged      = 0;
        // Each entry: { cards: [{value, isCritical, fromCritical}], score, isMiss }
        this.drawnRounds = [];
        this._shuffle(this.remaining);
    }

    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    // Reshuffle discards into remaining when empty. Returns false only if
    // truly nothing left (shouldn't normally occur with 18-card decks).
    _ensureAvailable() {
        if (this.remaining.length > 0) return true;
        if (this.discarded.length === 0) return false;
        this.remaining = [...this.discarded];
        this.discarded = [];
        this._shuffle(this.remaining);
        return true;
    }

    stageOne() {
        if (!this._ensureAvailable()) return false;
        this.staged++;
        return true;
    }

    unstageOne() {
        if (this.staged === 0) return false;
        this.staged--;
        return true;
    }

    clearStaged() { this.staged = 0; }

    reset() {
        this.remaining   = [...MIGHT_DECK_DEFS[this.color]];
        this.discarded   = [];
        this.staged      = 0;
        this.drawnRounds = [];
        this._shuffle(this.remaining);
    }

    get remainingCount() { return this.remaining.length; }
    get totalCount()     { return this.remaining.length + this.discarded.length; }
    get currentRound()   { return this.drawnRounds[this.drawnRounds.length - 1] || null; }
    get historyRounds()  { return this.drawnRounds.slice(0, -1); }
    get hasAnyDraws()    { return this.drawnRounds.length > 0; }
}

//
// ============================================================================
//  [MIGHT_STATE]
// ============================================================================
//

const mightDecks = {};
for (const side of MIGHT_SIDES) {
    for (const color of MIGHT_COLORS) {
        mightDecks[mightKey(side, color)] = new MightDeck(color, side);
    }
}

let mightUIBuilt = false;

function mightTotalStaged() {
    return Object.values(mightDecks).reduce((n, d) => n + d.staged, 0);
}

//
// ============================================================================
//  [MIGHT_DRAW]
// ============================================================================
//
// Draws all staged cards for a deck, auto-chaining on criticals for player
// decks. Monster decks draw the face value of criticals without chaining.
// Miss rule: 2 or more blank (0) cards in the INITIAL staged draw count as a
// miss. Blanks drawn via critical chains never contribute to the miss count.
// Monster decks never miss.

function mightDrawRound(deck) {
    const round = { cards: [], score: 0, isMiss: false };
    const initialCount = deck.staged;
    deck.staged = 0;

    function drawOne(fromCritical) {
        if (!deck._ensureAvailable()) return;
        const value      = deck.remaining.pop();
        const isCritical = isMightCritical(value);
        deck.discarded.push(value);
        round.cards.push({ value, isCritical, fromCritical });
        // Auto-chain: player decks only; monster decks never chain
        if (isCritical && deck.side !== 'monster') {
            drawOne(true);
        }
    }

    for (let i = 0; i < initialCount; i++) drawOne(false);

    round.score = round.cards.reduce((s, c) => s + parseMightValue(c.value), 0);
    const initialBlanks = round.cards.filter(c => !c.fromCritical && c.value === '0').length;
    round.isMiss = deck.side !== 'monster' && initialBlanks >= 2;
    deck.drawnRounds.push(round);
    return round;
}

//
// ============================================================================
//  [MIGHT_SVG]
// ============================================================================
//
// Isometric cube with corrected proportions: bottom vertex at y=42, total
// height 43. Three visible faces in light/dark/mid shades of the deck color.

function buildIsoCubeSVG(color) {
    const c   = MIGHT_COLOR_CFG[color];
    const top   = '20,2  39,12 20,22 1,12';
    const left  = '20,22  1,12  1,33 20,42';
    const right = '20,22 39,12 39,33 20,42';
    return (
        `<svg viewBox="0 0 40 43" width="40" height="42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
        `<polygon points="${top}"   fill="${c.cubeTop}"/>` +
        `<polygon points="${left}"  fill="${c.cubeLeft}"/>` +
        `<polygon points="${right}" fill="${c.cubeRight}"/>` +
        `</svg>`
    );
}

//
// ============================================================================
//  [MIGHT_RENDER]
// ============================================================================
//

function buildCardBackHTML(side, color) {
    const key  = mightKey(side, color);
    const deck = mightDecks[key];
    return (
        `<div class="might-card-back" id="might-cb-${key}" data-key="${key}" role="button" tabindex="0" ` +
              `aria-label="Stage card from ${MIGHT_COLOR_CFG[color].label} deck">` +
            `<div class="might-card-back-bg"></div>` +
            `<div class="might-card-back-overlay"></div>` +
            `<div class="might-card-back-content">` +
                buildIsoCubeSVG(color) +
                `<span class="might-remaining-count" id="might-rem-${key}">${deck.remainingCount}</span>` +
            `</div>` +
            `<div class="might-staged-badge d-none" id="might-badge-${key}">0</div>` +
        `</div>`
    );
}

function buildDeckRowHTML(side, color) {
    const key = mightKey(side, color);
    const cfg = MIGHT_COLOR_CFG[color];
    let emptySlots = '';
    for (let i = 0; i < MIGHT_DECK_SIZE; i++) {
        emptySlots += `<div class="might-card-slot-empty"></div>`;
    }
    return (
        `<div class="might-deck-row" data-key="${key}">` +
            `<div class="might-deck-left">` +
                `<div class="might-deck-label">${cfg.label}</div>` +
                buildCardBackHTML(side, color) +
                `<div class="might-deck-ctrl">` +
                    `<button class="btn btn-ghost-game btn-sm might-btn-unstage" data-key="${key}" title="Unstage one">&#8722;</button>` +
                    `<button class="btn btn-ghost-game btn-sm might-btn-reset"   data-key="${key}" title="Reset deck">Reset</button>` +
                `</div>` +
            `</div>` +
            `<div class="might-drawn-area" id="might-drawn-${key}">` +
                `<div class="might-history-area" id="might-hist-${key}"></div>` +
                `<div class="might-grid-area">` +
                    `<div class="might-grid" id="might-grid-${key}">${emptySlots}</div>` +
                    `<div class="might-score-row d-none" id="might-score-${key}"></div>` +
                `</div>` +
            `</div>` +
        `</div>`
    );
}

function buildSideHTML(side) {
    const title = side === 'player' ? 'Players' : 'Monsters';
    let rows = '';
    for (const color of MIGHT_COLORS) rows += buildDeckRowHTML(side, color);
    return (
        `<div class="might-side">` +
            `<div class="might-side-title might-side-${side}">${title}</div>` +
            rows +
        `</div>`
    );
}

function buildOverlayHTML() {
    return (
        `<div class="might-panel">` +
            `<div class="might-header">` +
                `<span class="might-panel-title">Might Decks</span>` +
                `<div class="d-flex gap-2 align-items-center">` +
                    `<button id="btn-might-reset-all" class="btn btn-ghost-game btn-sm">Reset All</button>` +
                    `<button id="btn-might-close"     class="btn btn-ghost-game btn-sm">&#10005;</button>` +
                `</div>` +
            `</div>` +
            `<div class="might-staging-bar" id="might-staging-bar">` +
                `<span class="might-staged-info" id="might-staged-info">Click a deck to stage / right-click or [-] to unstage</span>` +
                `<div class="d-flex gap-2 align-items-center">` +
                    `<button id="btn-might-clear" class="btn btn-ghost-game" style="display:none">Clear</button>` +
                    `<button id="btn-might-draw"  class="btn btn-primary-game btn-draw-might" style="display:none">Draw</button>` +
                `</div>` +
            `</div>` +
            `<div class="might-decks-area">` +
                buildSideHTML('player') +
                buildSideHTML('monster') +
            `</div>` +
        `</div>`
    );
}

//
// ============================================================================
//  [MIGHT_UPDATE]
// ============================================================================
//

function updateDeckDisplay(key) {
    const deck  = mightDecks[key];
    const remEl = document.getElementById(`might-rem-${key}`);
    if (remEl) remEl.textContent = deck.remainingCount;

    const badge = document.getElementById(`might-badge-${key}`);
    if (badge) {
        if (deck.staged > 0) {
            badge.textContent = deck.staged;
            badge.classList.remove('d-none');
        } else {
            badge.classList.add('d-none');
        }
    }

    const cb = document.getElementById(`might-cb-${key}`);
    if (cb) {
        cb.classList.toggle('might-cb-empty', deck.remainingCount === 0 && deck.totalCount === 0);
    }
}

function updateStagingBar() {
    const total    = mightTotalStaged();
    const infoEl   = document.getElementById('might-staged-info');
    const drawBtn  = document.getElementById('btn-might-draw');
    const clearBtn = document.getElementById('btn-might-clear');
    if (!infoEl) return;

    if (total === 0) {
        infoEl.textContent = 'Click a deck to stage / right-click or [-] to unstage';
        if (drawBtn)  drawBtn.style.display  = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
        return;
    }

    const parts = [];
    for (const side of MIGHT_SIDES) {
        for (const color of MIGHT_COLORS) {
            const deck = mightDecks[mightKey(side, color)];
            if (deck.staged > 0) {
                const sl = side === 'player' ? 'P' : 'M';
                parts.push(`${MIGHT_COLOR_CFG[color].label} (${sl}) x${deck.staged}`);
            }
        }
    }
    infoEl.textContent = `Staged: ${parts.join(', ')}`;
    if (drawBtn)  drawBtn.style.display  = '';
    if (clearBtn) clearBtn.style.display = '';
}

// Build one drawn-card div. compact=true produces history-row sized cards.
function buildDrawnCardHTML(cardEntry, cfg, compact) {
    const { value, isCritical, fromCritical } = cardEntry;
    const display    = isCritical   ? value.slice(1, -1) : value;
    const critClass  = isCritical   ? ' is-critical'  : '';
    const chainClass = fromCritical ? ' from-critical' : '';
    const sizeClass  = compact      ? ' card-compact'  : '';
    const shadowStyle = isCritical
        ? `box-shadow:0 0 14px ${cfg.critGlow},inset 0 0 6px rgba(255,255,255,0.1)`
        : '';
    const style = [
        `background:${cfg.cardBg}`,
        `border-color:${cfg.cardBorder}`,
        `color:${cfg.cardText}`,
        shadowStyle,
    ].filter(Boolean).join(';');
    const critStar = isCritical   ? `<span class="might-crit-star">&#9733;</span>` : '';
    const chainDot = fromCritical ? `<span class="might-chain-dot"></span>`        : '';
    return (
        `<div class="might-drawn-card${critClass}${chainClass}${sizeClass}" style="${style}">` +
            chainDot +
            critStar +
            `<span class="might-drawn-value">${display}</span>` +
        `</div>`
    );
}

function renderHistoryArea(key) {
    const deck   = mightDecks[key];
    const histEl = document.getElementById(`might-hist-${key}`);
    if (!histEl) return;

    const history = deck.historyRounds;
    if (history.length === 0) { histEl.innerHTML = ''; return; }

    const cfg = MIGHT_COLOR_CFG[deck.color];
    let html = '';
    history.forEach((round, idx) => {
        const cardsHtml = round.cards
            .map(c => buildDrawnCardHTML(c, cfg, true))
            .join('');
        const scoreHtml = round.isMiss
            ? `<span class="might-hist-miss">MISS</span>`
            : `<span class="might-hist-score">${round.score}</span>`;
        const rowMissClass = round.isMiss ? ' hist-row-miss' : '';
        html += (
            `<div class="might-history-row${rowMissClass}">` +
                `<span class="might-hist-label">R${idx + 1}</span>` +
                `<span class="might-hist-cards">${cardsHtml}</span>` +
                scoreHtml +
            `</div>`
        );
    });
    histEl.innerHTML = html;
    // Keep the most-recent history entry visible
    histEl.scrollTop = histEl.scrollHeight;
}

function renderCurrentRound(key) {
    const deck  = mightDecks[key];
    const grid  = document.getElementById(`might-grid-${key}`);
    if (!grid) return;

    const cfg   = MIGHT_COLOR_CFG[deck.color];
    const round = deck.currentRound;
    let html = '';
    for (let i = 0; i < MIGHT_DECK_SIZE; i++) {
        if (round && round.cards[i]) {
            html += buildDrawnCardHTML(round.cards[i], cfg, false);
        } else {
            html += `<div class="might-card-slot-empty"></div>`;
        }
    }
    grid.innerHTML = html;
}

function updateDeckScoreDisplay(key) {
    const deck     = mightDecks[key];
    const scoreRow = document.getElementById(`might-score-${key}`);
    if (!scoreRow) return;

    const round = deck.currentRound;
    if (!round) { scoreRow.classList.add('d-none'); return; }

    scoreRow.classList.remove('d-none');
    if (round.isMiss) {
        scoreRow.innerHTML =
            `<span class="might-score-miss-label">MISS</span>` +
            `<span class="might-score-total might-score-miss">${round.score}</span>`;
    } else {
        scoreRow.innerHTML =
            `<span class="might-score-label">Total</span>` +
            `<span class="might-score-total">${round.score}</span>`;
    }
}

function renderDeckDrawnArea(key) {
    renderHistoryArea(key);
    renderCurrentRound(key);
    updateDeckScoreDisplay(key);
}

//
// ============================================================================
//  [MIGHT_EVENTS]
// ============================================================================
//

function handleStage(key) {
    const deck = mightDecks[key];
    if (!deck) return;
    deck.stageOne();
    updateDeckDisplay(key);
    updateStagingBar();
}

function handleUnstage(key) {
    const deck = mightDecks[key];
    if (!deck) return;
    deck.unstageOne();
    updateDeckDisplay(key);
    updateStagingBar();
}

function handleClearAllStaged() {
    for (const deck of Object.values(mightDecks)) deck.clearStaged();
    for (const key of Object.keys(mightDecks)) updateDeckDisplay(key);
    updateStagingBar();
}

function handleDraw() {
    for (const [key, deck] of Object.entries(mightDecks)) {
        if (deck.staged === 0) continue;
        mightDrawRound(deck);
        renderDeckDrawnArea(key);
        updateDeckDisplay(key);
    }
    updateStagingBar();
}

function handleResetDeck(key) {
    const deck = mightDecks[key];
    if (!deck) return;
    deck.reset();
    renderDeckDrawnArea(key);
    updateDeckDisplay(key);
    updateStagingBar();
}

function handleResetAll() {
    for (const key of Object.keys(mightDecks)) {
        mightDecks[key].reset();
        renderDeckDrawnArea(key);
        updateDeckDisplay(key);
    }
    updateStagingBar();
}

//
// ============================================================================
//  [MIGHT_INIT]
// ============================================================================
//

function initMightUI() {
    const overlay = document.getElementById('might-overlay');
    if (!overlay) return;

    overlay.innerHTML = buildOverlayHTML();
    mightUIBuilt = true;

    // Left-click card back: stage one
    overlay.addEventListener('click', function(e) {
        const cb = e.target.closest('.might-card-back');
        if (cb) { handleStage(cb.dataset.key); return; }

        const unstageBtn = e.target.closest('.might-btn-unstage');
        if (unstageBtn) { handleUnstage(unstageBtn.dataset.key); return; }

        const resetBtn = e.target.closest('.might-btn-reset');
        if (resetBtn) { handleResetDeck(resetBtn.dataset.key); return; }
    });

    // Right-click card back: unstage one
    overlay.addEventListener('contextmenu', function(e) {
        const cb = e.target.closest('.might-card-back');
        if (cb) { e.preventDefault(); handleUnstage(cb.dataset.key); }
    });

    // Keyboard: Enter/Space on focused card back stages one
    overlay.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const cb = e.target.closest('.might-card-back');
        if (cb) { e.preventDefault(); handleStage(cb.dataset.key); }
    });

    document.getElementById('btn-might-draw').addEventListener('click', handleDraw);
    document.getElementById('btn-might-clear').addEventListener('click', handleClearAllStaged);
    document.getElementById('btn-might-reset-all').addEventListener('click', handleResetAll);
    document.getElementById('btn-might-close').addEventListener('click', closeMightOverlay);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeMightOverlay();
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && overlay.style.display !== 'none') closeMightOverlay();
    });
}

//
// ============================================================================
//  [MIGHT_API]
// ============================================================================
//

function openMightOverlay() {
    if (!mightUIBuilt) initMightUI();
    const overlay = document.getElementById('might-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function closeMightOverlay() {
    const overlay = document.getElementById('might-overlay');
    if (overlay) overlay.style.display = 'none';
}
