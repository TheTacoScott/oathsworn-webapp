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
 *   [MIGHT_STATE]       8 global deck instances + session state
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
        label:     'White',
        cubeTop:   '#c8c0b0', cubeRight: '#908880', cubeLeft: '#686058',
        cardBg:    '#2c2820', cardBorder: '#706858', cardText: '#ddd8c8',
        critGlow:  '#ffee88',
    },
    yellow: {
        label:     'Yellow',
        cubeTop:   '#c8a028', cubeRight: '#906810', cubeLeft: '#604408',
        cardBg:    '#282008', cardBorder: '#907828', cardText: '#e8d058',
        critGlow:  '#ffe020',
    },
    red: {
        label:     'Red',
        cubeTop:   '#902020', cubeRight: '#5c0808', cubeLeft: '#3c0404',
        cardBg:    '#240808', cardBorder: '#803030', cardText: '#e87070',
        critGlow:  '#ff5050',
    },
    black: {
        label:     'Black',
        cubeTop:   '#383858', cubeRight: '#181828', cubeLeft: '#0c0c18',
        cardBg:    '#0e0e1c', cardBorder: '#484868', cardText: '#9088c0',
        critGlow:  '#b080f8',
    },
};

const MIGHT_SIDES        = ['player', 'monster'];
const MIGHT_COLORS       = ['white', 'yellow', 'red', 'black'];
const MIGHT_DISPLAY_SLOTS = 10; // max draw is 10; extra chain draws overflow naturally

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
        // Each entry: { cards: [{value, isCritical, fromCritical}], score, sessionId }
        this.drawnRounds = [];
        this._shuffle(this.remaining);
    }

    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

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

let mightUIBuilt    = false;
let mightSessionId  = 0;  // increments on each Draw click
let mightLastResult = null; // { total, isMiss } - cleared when new cards are staged

function mightTotalStaged() {
    return Object.values(mightDecks).reduce((n, d) => n + d.staged, 0);
}

// Returns 'player', 'monster', or null depending on which side has staged cards.
function mightActiveSide() {
    for (const deck of Object.values(mightDecks)) {
        if (deck.staged > 0) return deck.side;
    }
    return null;
}

//
// ============================================================================
//  [MIGHT_DRAW]
// ============================================================================
//
// Draws all staged cards for one deck, auto-chaining on criticals for player
// decks. Monster decks take the face value of criticals without chaining.
//
// Miss rule is session-level (across all decks, computed in handleDraw):
//   2+ blank (0) cards from the INITIAL staged draw of player decks = miss.
//   Blanks drawn via critical chains never count toward the miss threshold.
//   Monster decks never miss.

function mightDrawRound(deck, sessionId) {
    const round = { cards: [], score: 0, sessionId };
    const initialCount = deck.staged;
    deck.staged = 0;

    function drawOne(fromCritical) {
        if (!deck._ensureAvailable()) return;
        const value      = deck.remaining.pop();
        const isCritical = isMightCritical(value);
        deck.discarded.push(value);
        round.cards.push({ value, isCritical, fromCritical });
        if (isCritical && deck.side !== 'monster') {
            drawOne(true); // auto-chain for player decks only
        }
    }

    for (let i = 0; i < initialCount; i++) drawOne(false);

    round.score = round.cards.reduce((s, c) => s + parseMightValue(c.value), 0);
    deck.drawnRounds.push(round);
    return round;
}

//
// ============================================================================
//  [MIGHT_SVG]
// ============================================================================
//

function buildIsoCubeSVG(color) {
    const c     = MIGHT_COLOR_CFG[color];
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
    for (let i = 0; i < MIGHT_DISPLAY_SLOTS; i++) {
        emptySlots += `<div class="might-card-slot-empty"></div>`;
    }
    return (
        `<div class="might-deck-row" data-key="${key}">` +
            `<div class="might-deck-left">` +
                `<div class="might-deck-label">${cfg.label}</div>` +
                buildCardBackHTML(side, color) +
                `<div class="might-deck-ctrl">` +
                    `<button class="btn btn-ghost-game btn-sm might-btn-unstage" data-key="${key}" title="Unstage one">&#8722;</button>` +
                    `<button class="btn btn-ghost-game btn-sm might-btn-stage"   data-key="${key}" title="Stage one">&#43;</button>` +
                `</div>` +
            `</div>` +
            `<div class="might-drawn-area" id="might-drawn-${key}">` +
                `<div class="might-history-area" id="might-hist-${key}"></div>` +
                `<div class="might-grid" id="might-grid-${key}">${emptySlots}</div>` +
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
                    `<button id="btn-might-reset-all" class="btn btn-ghost-game btn-sm">Reshuffle All</button>` +
                    `<button id="btn-might-close"     class="btn btn-ghost-game btn-sm">&#10005;</button>` +
                `</div>` +
            `</div>` +
            `<div class="might-staging-bar">` +
                `<span class="might-staged-info" id="might-staged-info">Click a deck to stage cards</span>` +
                `<div class="d-flex gap-2 align-items-center">` +
                    `<button id="btn-might-clear" class="btn btn-ghost-game">Clear Staged</button>` +
                    `<button id="btn-might-draw"  class="btn btn-primary-game btn-draw-might" disabled>Draw</button>` +
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

// Locks card backs on the side opposite to the currently staged side.
// When nothing is staged, all card backs are unlocked.
function updateLockStates() {
    const activeSide = mightActiveSide();
    for (const [key, deck] of Object.entries(mightDecks)) {
        const cb = document.getElementById(`might-cb-${key}`);
        if (!cb) continue;
        cb.classList.toggle('might-cb-locked', activeSide !== null && deck.side !== activeSide);
    }
}

// Updates the staging bar text and Draw button enabled state.
// Clear/Draw buttons are always visible; Draw is enabled only when staged > 0.
function updateStagingBar() {
    const total    = mightTotalStaged();
    const infoEl   = document.getElementById('might-staged-info');
    const drawBtn  = document.getElementById('btn-might-draw');
    if (!infoEl) return;

    if (total > 0) {
        // New staging clears the previous draw result
        mightLastResult = null;
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
        if (drawBtn) drawBtn.disabled = false;
    } else if (mightLastResult) {
        // Show the combined draw result, labelled by which side drew
        const sideLabel = mightLastResult.side === 'player' ? 'Player' : 'Monster';
        if (mightLastResult.isMiss) {
            infoEl.innerHTML =
                `<span class="might-result-miss">${sideLabel} MISS</span>` +
                `<span class="might-result-miss-score"> (${mightLastResult.total})</span>`;
        } else {
            infoEl.innerHTML =
                `<span class="might-result-label">${sideLabel} Total: </span>` +
                `<span class="might-result-total">${mightLastResult.total}</span>`;
        }
        if (drawBtn) drawBtn.disabled = true;
    } else {
        infoEl.textContent = 'Click a deck to stage cards';
        if (drawBtn) drawBtn.disabled = true;
    }
    updateLockStates();
}

// Build one drawn-card div. compact=true -> history-row size.
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
        const cardsHtml = round.cards.map(c => buildDrawnCardHTML(c, cfg, true)).join('');
        html += (
            `<div class="might-history-row">` +
                `<span class="might-hist-label">R${idx + 1}</span>` +
                `<span class="might-hist-cards">${cardsHtml}</span>` +
                `<span class="might-hist-score">${round.score}</span>` +
            `</div>`
        );
    });
    histEl.innerHTML = html;
    histEl.scrollTop = histEl.scrollHeight;
}

function renderCurrentRound(key) {
    const deck  = mightDecks[key];
    const grid  = document.getElementById(`might-grid-${key}`);
    if (!grid) return;

    const cfg   = MIGHT_COLOR_CFG[deck.color];
    const round = deck.currentRound;
    let html    = '';

    if (round) {
        for (const card of round.cards) {
            html += buildDrawnCardHTML(card, cfg, false);
        }
        // Pad with empty slots up to the minimum display size
        for (let i = round.cards.length; i < MIGHT_DISPLAY_SLOTS; i++) {
            html += `<div class="might-card-slot-empty"></div>`;
        }
    } else {
        for (let i = 0; i < MIGHT_DISPLAY_SLOTS; i++) {
            html += `<div class="might-card-slot-empty"></div>`;
        }
    }
    grid.innerHTML = html;
}

function renderDeckDrawnArea(key) {
    renderHistoryArea(key);
    renderCurrentRound(key);
}

//
// ============================================================================
//  [MIGHT_EVENTS]
// ============================================================================
//

function handleStage(key) {
    const deck = mightDecks[key];
    if (!deck) return;
    const activeSide = mightActiveSide();
    if (activeSide !== null && activeSide !== deck.side) return;
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
    mightSessionId++;
    const draws = [];

    for (const [key, deck] of Object.entries(mightDecks)) {
        if (deck.staged === 0) continue;
        const round = mightDrawRound(deck, mightSessionId);
        draws.push({ round, side: deck.side });
        renderDeckDrawnArea(key);
        updateDeckDisplay(key);
    }

    if (draws.length > 0) {
        const total = draws.reduce((s, { round }) => s + round.score, 0);
        // Miss: 2+ blank ('0') cards in the INITIAL draw of player decks only.
        // Blanks from critical chains are exempt.
        const playerInitialBlanks = draws
            .filter(({ side }) => side !== 'monster')
            .flatMap(({ round }) => round.cards)
            .filter(c => !c.fromCritical && c.value === '0')
            .length;
        mightLastResult = { total, isMiss: playerInitialBlanks >= 2, side: draws[0].side };
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
    mightLastResult = null;
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

    overlay.addEventListener('click', function(e) {
        const cb = e.target.closest('.might-card-back');
        if (cb) { handleStage(cb.dataset.key); return; }

        const unstageBtn = e.target.closest('.might-btn-unstage');
        if (unstageBtn) { handleUnstage(unstageBtn.dataset.key); return; }

        const stageBtn = e.target.closest('.might-btn-stage');
        if (stageBtn) { handleStage(stageBtn.dataset.key); return; }
    });

    overlay.addEventListener('contextmenu', function(e) {
        const cb = e.target.closest('.might-card-back');
        if (cb) { e.preventDefault(); handleUnstage(cb.dataset.key); }
    });

    overlay.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const cb = e.target.closest('.might-card-back');
        if (cb) { e.preventDefault(); handleStage(cb.dataset.key); }
    });

    overlay.addEventListener('wheel', function(e) {
        const cb = e.target.closest('.might-card-back');
        if (!cb) return;
        e.preventDefault();
        if (e.deltaY < 0) {
            handleStage(cb.dataset.key);
        } else {
            handleUnstage(cb.dataset.key);
        }
    }, { passive: false });

    document.getElementById('btn-might-draw').addEventListener('click', handleDraw);
    document.getElementById('btn-might-clear').addEventListener('click', handleClearAllStaged);
    document.getElementById('btn-might-reset-all').addEventListener('click', handleResetAll);
    document.getElementById('btn-might-close').addEventListener('click', closeMightOverlay);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeMightOverlay();
    });

    document.addEventListener('keydown', function(e) {
        if (overlay.style.display === 'none') return;
        if (e.key === 'Escape') { closeMightOverlay(); return; }
        if (e.key === 'Enter') {
            const drawBtn = document.getElementById('btn-might-draw');
            if (drawBtn && !drawBtn.disabled) { e.preventDefault(); drawBtn.click(); }
            return;
        }
        if (e.key === 'Backspace') {
            e.preventDefault();
            handleClearAllStaged();
        }
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
