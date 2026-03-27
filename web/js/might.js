/**
 * might.js - Might Deck logic and UI for the Oathsworn web app.
 *
 * All card interaction lives here; main.js only calls openMightOverlay() /
 * closeMightOverlay() and wires the trigger buttons.
 *
 * TABLE OF CONTENTS  (Ctrl+F the [TAG] to jump to each section)
 *
 *   [MIGHT_CONSTANTS]   deck definitions, color configs, key helpers
 *   [MIGHT_DECK_CLASS]  MightDeck - shuffle, stage, draw, reset
 *   [MIGHT_STATE]       8 global deck instances
 *   [MIGHT_SVG]         buildIsoCubeSVG() for card backs
 *   [MIGHT_RENDER]      HTML builders for rows, drawn cards, staging bar
 *   [MIGHT_UPDATE]      DOM update helpers (count badges, staging bar)
 *   [MIGHT_EVENTS]      event handlers (stage, unstage, draw, reset)
 *   [MIGHT_INIT]        initMightUI() - build DOM, wire events
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

// Color configs: cube face shades (top/right/left) and drawn-card styling.
const MIGHT_COLOR_CFG = {
    white: {
        label:     'White',
        cubeTop:   '#c8c0b0',
        cubeRight: '#908880',
        cubeLeft:  '#686058',
        cardBg:    '#2c2820',
        cardBorder:'#585048',
        cardText:  '#ddd8c8',
        critGlow:  '#ffee88',
    },
    yellow: {
        label:     'Yellow',
        cubeTop:   '#c8a028',
        cubeRight: '#906810',
        cubeLeft:  '#604408',
        cardBg:    '#282008',
        cardBorder:'#806020',
        cardText:  '#e8d058',
        critGlow:  '#ffe020',
    },
    red: {
        label:     'Red',
        cubeTop:   '#902020',
        cubeRight: '#5c0808',
        cubeLeft:  '#3c0404',
        cardBg:    '#240808',
        cardBorder:'#702020',
        cardText:  '#e87070',
        critGlow:  '#ff5050',
    },
    black: {
        label:     'Black',
        cubeTop:   '#383858',
        cubeRight: '#181828',
        cubeLeft:  '#0c0c18',
        cardBg:    '#0e0e1c',
        cardBorder:'#383858',
        cardText:  '#9088c0',
        critGlow:  '#b080f8',
    },
};

const MIGHT_SIDES  = ['player', 'monster'];
const MIGHT_COLORS = ['white', 'yellow', 'red', 'black'];

function mightKey(side, color) {
    return `${side}_${color}`;
}

function isMightCritical(value) {
    return value.startsWith('(');
}

//
// ============================================================================
//  [MIGHT_DECK_CLASS]
// ============================================================================
//

class MightDeck {
    constructor(color, side) {
        this.color = color;
        this.side  = side;
        this.remaining    = [...MIGHT_DECK_DEFS[color]];
        this.discarded    = [];
        this.staged       = 0;       // cards queued but not yet revealed
        this.drawnDisplay = [];      // { value, isCritical } - for on-screen display
        this._shuffle(this.remaining);
    }

    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    // Ensures at least one card is available, reshuffling discards if needed.
    // Returns true if a card is available, false if the deck is truly empty.
    _ensureAvailable() {
        if (this.remaining.length > 0) return true;
        if (this.discarded.length === 0) return false;
        this.remaining = [...this.discarded];
        this.discarded = [];
        this._shuffle(this.remaining);
        return true;
    }

    // Stage one card (queues it for the next draw; value not yet revealed).
    // Returns true on success, false if deck is empty.
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

    clearStaged() {
        this.staged = 0;
    }

    // Draw all staged cards. Returns array of { value, isCritical, color, side }.
    drawStaged() {
        const results = [];
        const count = this.staged;
        this.staged = 0;
        for (let i = 0; i < count; i++) {
            if (!this._ensureAvailable()) break;
            const value      = this.remaining.pop();
            const isCritical = isMightCritical(value);
            this.discarded.push(value);
            this.drawnDisplay.push({ value, isCritical });
            results.push({ value, isCritical, color: this.color, side: this.side });
        }
        return results;
    }

    reset() {
        this.remaining    = [...MIGHT_DECK_DEFS[this.color]];
        this.discarded    = [];
        this.staged       = 0;
        this.drawnDisplay = [];
        this._shuffle(this.remaining);
    }

    get remainingCount() { return this.remaining.length; }
    get totalCount()     { return this.remaining.length + this.discarded.length; }
    get isReshuffle()    { return this.remaining.length === 0 && this.discarded.length > 0; }
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
//  [MIGHT_SVG]
// ============================================================================
//

// Generates an inline SVG isometric cube sized ~36x32 with three faces
// in the shades defined by the color config for `color`.
function buildIsoCubeSVG(color) {
    const c = MIGHT_COLOR_CFG[color];
    // Isometric cube: top diamond + left parallelogram + right parallelogram.
    // Coordinates chosen so the three faces tile cleanly within a 40x36 viewBox.
    const top   = '20,1  39,11 20,21 1,11';
    const left  = '20,21  1,11  1,31 20,35';
    const right = '20,21 39,11 39,31 20,35';
    return (
        `<svg viewBox="0 0 40 36" width="36" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
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
    const key = mightKey(side, color);
    const deck = mightDecks[key];
    return (
        `<div class="might-card-back" id="might-cb-${key}" data-key="${key}" role="button" tabindex="0" aria-label="Stage card from ${MIGHT_COLOR_CFG[color].label} deck">` +
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
    const key  = mightKey(side, color);
    const cfg  = MIGHT_COLOR_CFG[color];
    return (
        `<div class="might-deck-row">` +
            `<div class="might-deck-left">` +
                `<div class="might-deck-label">${cfg.label}</div>` +
                buildCardBackHTML(side, color) +
                `<div class="might-deck-ctrl">` +
                    `<button class="btn btn-ghost-game btn-sm might-btn-unstage" data-key="${key}" title="Remove one staged card">&#8722;</button>` +
                    `<button class="btn btn-ghost-game btn-sm might-btn-reset"   data-key="${key}" title="Reset this deck">Reset</button>` +
                `</div>` +
            `</div>` +
            `<div class="might-drawn-area" id="might-drawn-${key}"></div>` +
        `</div>`
    );
}

function buildSideHTML(side) {
    const title = side === 'player' ? 'Players' : 'Monsters';
    let rows = '';
    for (const color of MIGHT_COLORS) {
        rows += buildDeckRowHTML(side, color);
    }
    return (
        `<div class="might-side">` +
            `<div class="might-side-title">${title}</div>` +
            rows +
        `</div>`
    );
}

function buildDrawnCardHTML(value, isCritical, color) {
    const cfg = MIGHT_COLOR_CFG[color];
    const display = isCritical ? value.slice(1, -1) : value; // strip parens for display
    const critClass = isCritical ? ' is-critical' : '';
    const critStar  = isCritical ? '<span class="might-crit-star" title="Critical - draw again">&#9733;</span>' : '';
    // Inline styles carry per-color values; CSS class handles sizing/layout.
    const style = [
        `background:${cfg.cardBg}`,
        `border-color:${cfg.cardBorder}`,
        `color:${cfg.cardText}`,
        isCritical ? `box-shadow:0 0 10px ${cfg.critGlow},inset 0 0 6px rgba(255,255,255,0.08)` : '',
    ].filter(Boolean).join(';');
    return (
        `<div class="might-drawn-card${critClass}" style="${style}">` +
            critStar +
            `<span class="might-drawn-value">${display}</span>` +
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
                    `<button id="btn-might-close"     class="btn btn-ghost-game btn-sm">&#10005; Close</button>` +
                `</div>` +
            `</div>` +
            `<div class="might-staging-bar" id="might-staging-bar">` +
                `<span class="might-staged-info" id="might-staged-info">Tap a card deck to stage it</span>` +
                `<div class="d-flex gap-2">` +
                    `<button id="btn-might-clear" class="btn btn-ghost-game btn-sm" style="display:none">Clear</button>` +
                    `<button id="btn-might-draw"  class="btn btn-primary-game btn-sm" style="display:none">Draw</button>` +
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

// Update the remaining-count label and staged badge for one deck.
function updateDeckDisplay(key) {
    const deck = mightDecks[key];
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

    // Dim the card back slightly when deck is empty but can auto-reshuffle
    const cb = document.getElementById(`might-cb-${key}`);
    if (cb) {
        cb.classList.toggle('might-cb-empty', deck.remainingCount === 0 && deck.totalCount === 0);
    }
}

// Rebuild the staging bar summary text and show/hide Draw+Clear buttons.
function updateStagingBar() {
    const total = mightTotalStaged();
    const infoEl = document.getElementById('might-staged-info');
    const drawBtn  = document.getElementById('btn-might-draw');
    const clearBtn = document.getElementById('btn-might-clear');
    if (!infoEl) return;

    if (total === 0) {
        infoEl.textContent = 'Tap a card deck to stage it';
        if (drawBtn)  drawBtn.style.display  = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
        return;
    }

    // Build per-deck summary
    const parts = [];
    for (const side of MIGHT_SIDES) {
        for (const color of MIGHT_COLORS) {
            const deck = mightDecks[mightKey(side, color)];
            if (deck.staged > 0) {
                const sideLabel  = side === 'player' ? 'P' : 'M';
                const colorLabel = MIGHT_COLOR_CFG[color].label;
                parts.push(`${colorLabel} (${sideLabel}) x${deck.staged}`);
            }
        }
    }
    infoEl.textContent = `Staged: ${parts.join(', ')}`;
    if (drawBtn)  drawBtn.style.display  = '';
    if (clearBtn) clearBtn.style.display = '';
}

// Append a drawn card to the correct drawn area.
function appendDrawnCard(key, value, isCritical, color) {
    const area = document.getElementById(`might-drawn-${key}`);
    if (!area) return;
    const div = document.createElement('div');
    div.innerHTML = buildDrawnCardHTML(value, isCritical, color);
    const card = div.firstElementChild;
    // Brief flash animation for newly drawn cards
    card.classList.add('might-drawn-new');
    area.appendChild(card);
    // Scroll the drawn area to the right to show the newest card
    area.scrollLeft = area.scrollWidth;
    setTimeout(() => card.classList.remove('might-drawn-new'), 600);
}

//
// ============================================================================
//  [MIGHT_EVENTS]
// ============================================================================
//

// Stage one card from the deck whose card-back was clicked.
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
    for (const deck of Object.values(mightDecks)) {
        deck.clearStaged();
    }
    for (const key of Object.keys(mightDecks)) {
        updateDeckDisplay(key);
    }
    updateStagingBar();
}

// Draw all staged cards. Auto-stages extras for any criticals that appear.
function handleDraw() {
    const criticalAutoStaged = {};

    for (const [key, deck] of Object.entries(mightDecks)) {
        if (deck.staged === 0) continue;
        const results = deck.drawStaged();
        for (const { value, isCritical, color, side } of results) {
            appendDrawnCard(key, value, isCritical, color);
            if (isCritical) {
                // Auto-stage one more from the same deck for the follow-up draw
                const didStage = deck.stageOne();
                if (didStage) {
                    criticalAutoStaged[key] = (criticalAutoStaged[key] || 0) + 1;
                }
            }
        }
        updateDeckDisplay(key);
    }

    // If any criticals triggered an auto-stage, update the bar so the Draw
    // button reappears with an explanatory message.
    const critCount = Object.values(criticalAutoStaged).reduce((n, v) => n + v, 0);
    if (critCount > 0) {
        updateStagingBar();
        // Replace the generic "Staged:" text with a critical notice
        const infoEl = document.getElementById('might-staged-info');
        if (infoEl) {
            const plural = critCount === 1 ? 'Critical' : 'Criticals';
            infoEl.textContent = `${critCount} ${plural} - draw again!`;
        }
    } else {
        updateStagingBar();
    }
}

function handleResetDeck(key) {
    const deck = mightDecks[key];
    if (!deck) return;
    deck.reset();
    // Clear the drawn display for this deck
    const drawnArea = document.getElementById(`might-drawn-${key}`);
    if (drawnArea) drawnArea.innerHTML = '';
    updateDeckDisplay(key);
    updateStagingBar();
}

function handleResetAll() {
    for (const key of Object.keys(mightDecks)) {
        mightDecks[key].reset();
        const drawnArea = document.getElementById(`might-drawn-${key}`);
        if (drawnArea) drawnArea.innerHTML = '';
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

    // Card back click -> stage one
    overlay.addEventListener('click', function(e) {
        const cb = e.target.closest('.might-card-back');
        if (cb) { handleStage(cb.dataset.key); return; }

        const unstageBtn = e.target.closest('.might-btn-unstage');
        if (unstageBtn) { handleUnstage(unstageBtn.dataset.key); return; }

        const resetBtn = e.target.closest('.might-btn-reset');
        if (resetBtn) { handleResetDeck(resetBtn.dataset.key); return; }
    });

    // Keyboard accessibility for card backs (Enter/Space to stage)
    overlay.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const cb = e.target.closest('.might-card-back');
        if (cb) { e.preventDefault(); handleStage(cb.dataset.key); }
    });

    document.getElementById('btn-might-draw').addEventListener('click', handleDraw);
    document.getElementById('btn-might-clear').addEventListener('click', handleClearAllStaged);
    document.getElementById('btn-might-reset-all').addEventListener('click', handleResetAll);
    document.getElementById('btn-might-close').addEventListener('click', closeMightOverlay);

    // Close when clicking the backdrop (outside the panel)
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeMightOverlay();
    });

    // Escape key closes the overlay
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && overlay.style.display !== 'none') {
            closeMightOverlay();
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
