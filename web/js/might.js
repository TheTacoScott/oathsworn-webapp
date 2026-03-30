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
const MIGHT_DISPLAY_SLOTS = 20;  // 2 rows of 10; cards wrap to row 2 when > 10 are drawn
const MIGHT_MAX_STAGED    = 20;  // combined cap across all decks
const MIGHT_COLOR_ORDER   = { white: 0, yellow: 1, red: 2, black: 3 };

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

let mightUIBuilt      = false;
let mightSessionId    = 0;   // increments on each Draw click
let mightLastResult   = null; // { total, isMiss, side } - cleared when new cards are staged
let mightDefense        = 2;   // defense value for damage calc; range 0-20, 0 acts like 1
let mightAttack         = 0;   // manually-adjustable attack value; seeded from draw result; range 0-100
let mightAttackNatural  = 0;   // natural attack value from most recent draw (before manual adjustment)
// Combined side-level history. One entry per Draw click:
//   { sessionId, side, cards: [{...card, cfg}], total, isMiss }
let mightSessionHistory = [];
let mightLastDrawCards  = [];  // flat card list from the most recent draw, for the shared grid

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

// Recomputes total/miss from non-disabled cards in mightLastDrawCards.
function computeLiveResult() {
    if (mightLastDrawCards.length === 0) return null;
    const side    = mightLastDrawCards[0].side;
    const enabled = mightLastDrawCards.filter(c => !c.disabled);
    const total   = enabled.reduce((s, c) => s + parseMightValue(c.value), 0);
    const playerInitialBlanks = (side !== 'monster')
        ? enabled.filter(c => !c.fromCritical && c.value === '0').length
        : 0;
    const isMiss = playerInitialBlanks >= 2;
    return { total, isMiss, side };
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

function buildBloodDropSVG() {
    return (
        `<svg viewBox="0 0 24 28" width="20" height="24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block;flex-shrink:0">` +
        `<path d="M12 3 C12 3 5 13 5 18 A7 7 0 0 0 19 18 C19 13 12 3 12 3 Z" fill="#cc2222" stroke="#991111" stroke-width="1"/>` +
        `</svg>`
    );
}

function buildShieldSVG() {
    return (
        `<svg viewBox="0 0 24 28" width="22" height="26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block;flex-shrink:0">` +
        `<path d="M12 2 L22 6.5 L22 15 Q22 23 12 27 Q2 23 2 15 L2 6.5 Z" fill="#3a6acc" stroke="#2255bb" stroke-width="1"/>` +
        `</svg>`
    );
}

function buildIsoCubeSVG(color) {
    const c     = MIGHT_COLOR_CFG[color];
    const top   = '20,2  39,12 20,22 1,12';
    const left  = '20,22  1,12  1,33 20,42';
    const right = '20,22 39,12 39,33 20,42';
    return (
        `<svg viewBox="0 0 40 43" width="58" height="62" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
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

function buildDeckSlotHTML(side, color) {
    const key = mightKey(side, color);
    const cfg = MIGHT_COLOR_CFG[color];
    return (
        `<div class="might-deck-slot" id="might-slot-${key}">` +
            `<div class="might-deck-label">${cfg.label}</div>` +
            buildCardBackHTML(side, color) +
            `<div class="might-deck-ctrl">` +
                `<button class="btn btn-ghost-game btn-sm might-btn-unstage" data-key="${key}" title="Unstage one">&#8722;</button>` +
                `<button class="btn btn-ghost-game btn-sm might-btn-stage"   data-key="${key}" title="Stage one">&#43;</button>` +
            `</div>` +
        `</div>`
    );
}

function buildDecksRowHTML() {
    const playerSlots  = MIGHT_COLORS.map(c => buildDeckSlotHTML('player',  c)).join('');
    const monsterSlots = MIGHT_COLORS.map(c => buildDeckSlotHTML('monster', c)).join('');
    return (
        `<div class="might-decks-row">` +
            `<div class="might-deck-group">` +
                `<div class="might-deck-group-label might-side-player" data-string-key="ui.might_players">${S('ui.might_players')}</div>` +
                `<div class="might-deck-group-inner">${playerSlots}</div>` +
            `</div>` +
            `<div class="might-decks-divider"></div>` +
            `<div class="might-deck-group">` +
                `<div class="might-deck-group-label might-side-monster" data-string-key="ui.might_monsters">${S('ui.might_monsters')}</div>` +
                `<div class="might-deck-group-inner">${monsterSlots}</div>` +
            `</div>` +
        `</div>`
    );
}

function buildSharedDrawnHTML() {
    let emptySlots = '';
    for (let i = 0; i < MIGHT_DISPLAY_SLOTS; i++) {
        emptySlots += `<div class="might-card-slot-empty"></div>`;
    }
    return (
        `<div class="might-shared-drawn">` +
            `<div class="might-grid" id="might-shared-grid">${emptySlots}</div>` +
        `</div>`
    );
}

function buildHistoryModalHTML() {
    return (
        `<div class="might-hist-modal" id="might-hist-modal" style="display:none">` +
            `<div class="might-hist-modal-inner">` +
                `<div class="might-hist-modal-header">` +
                    `<span class="might-hist-panel-title" data-string-key="ui.draw_history">${S('ui.draw_history')}</span>` +
                    `<div class="d-flex gap-2 align-items-center">` +
                        `<button class="btn btn-ghost-game btn-sm" id="btn-might-hist-clear" data-string-key="ui.clear_history">${S('ui.clear_history')}</button>` +
                        `<button class="btn btn-ghost-game btn-sm" id="btn-might-hist-close">&#10005;</button>` +
                    `</div>` +
                `</div>` +
                `<div class="might-hist-modal-body">` +
                    `<div class="might-hist-modal-col">` +
                        `<div class="might-hist-col-title might-side-player" data-string-key="ui.might_players">${S('ui.might_players')}</div>` +
                        `<div class="might-hist-panel-body" id="might-hist-body-player"></div>` +
                    `</div>` +
                    `<div class="might-hist-modal-col">` +
                        `<div class="might-hist-col-title might-side-monster" data-string-key="ui.might_monsters">${S('ui.might_monsters')}</div>` +
                        `<div class="might-hist-panel-body" id="might-hist-body-monster"></div>` +
                    `</div>` +
                `</div>` +
            `</div>` +
        `</div>`
    );
}

function buildOverlayHTML() {
    return (
        `<div class="might-panel">` +
            `<div class="might-header">` +
                `<span class="might-panel-title" data-string-key="ui.might_decks">${S('ui.might_decks')}</span>` +
                `<div class="d-flex gap-2 align-items-center">` +
                    `<button id="btn-might-history"   class="btn btn-ghost-game btn-sm" data-string-key="ui.history">${S('ui.history')}</button>` +
                    `<button id="btn-might-reset-all" class="btn btn-ghost-game btn-sm" data-string-key="ui.reshuffle_all">${S('ui.reshuffle_all')}</button>` +
                    `<button id="btn-might-settings"  class="btn btn-ghost-game btn-sm" title="Settings"><img src="data/ui/settings.png" class="settings-icon" alt="Settings"></button>` +
                    `<button id="btn-might-close"     class="btn btn-ghost-game btn-sm">&#10005;</button>` +
                `</div>` +
            `</div>` +
            `<div class="might-staging-bar">` +
                `<span class="might-staged-info" id="might-staged-info" data-string-key="ui.might_stage_prompt">${S('ui.might_stage_prompt')}</span>` +
                `<div class="might-attack-widget" id="might-attack-widget" title="Attack — left-click or scroll up to increase, right-click or scroll down to decrease">` +
                    `<div class="might-attack-display">` +
                        `<span class="might-card-total" id="might-card-total"></span>` +
                        buildBloodDropSVG() +
                        `<span class="might-attack-value" id="might-attack-value">0</span>` +
                        `<span class="might-attack-sync" id="might-attack-sync" title="Attack modified from drawn value">&#9679;</span>` +
                    `</div>` +
                    `<div class="might-defense-ctrl">` +
                        `<button class="btn btn-ghost-game btn-sm might-btn-atk-dec" title="Decrease attack">&#8722;</button>` +
                        `<button class="btn btn-ghost-game btn-sm might-btn-atk-inc" title="Increase attack">&#43;</button>` +
                    `</div>` +
                `</div>` +
                `<div class="might-defense-widget" id="might-defense-widget" title="Defense — left-click or scroll up to increase, right-click or scroll down to decrease">` +
                    `<div class="might-defense-display">` +
                        buildShieldSVG() +
                        `<span class="might-defense-value" id="might-defense-value">2</span>` +
                    `</div>` +
                    `<div class="might-defense-ctrl">` +
                        `<button class="btn btn-ghost-game btn-sm might-btn-def-dec" title="Decrease defense">&#8722;</button>` +
                        `<button class="btn btn-ghost-game btn-sm might-btn-def-inc" title="Increase defense">&#43;</button>` +
                    `</div>` +
                `</div>` +
                `<div class="might-damage-result" id="might-damage-result">` +
                    `<span class="might-damage-eq">=</span>` +
                    `<span class="might-damage-out" id="might-damage-out">${S('ui.might_damage').replace('%s', 0)}</span>` +
                `</div>` +
                `<div class="might-staging-bar-actions">` +
                    `<button id="btn-might-clear-draw" class="btn btn-ghost-game btn-draw-might" data-string-key="ui.clear" disabled>${S('ui.clear')}</button>` +
                    `<button id="btn-might-draw-more"  class="btn btn-ghost-game btn-draw-might" data-string-key="ui.draw_more" disabled>${S('ui.draw_more')}</button>` +
                    `<button id="btn-might-draw"       class="btn btn-primary-game btn-draw-might" data-string-key="ui.clear_and_draw" disabled>${S('ui.clear_and_draw')}</button>` +
                `</div>` +
            `</div>` +
            buildDecksRowHTML() +
            buildSharedDrawnHTML() +
            buildHistoryModalHTML() +
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

function setMightDefense(value) {
    mightDefense = Math.max(0, Math.min(20, value));
    const el = document.getElementById('might-defense-value');
    if (el) el.textContent = mightDefense;
    updateStagingBar();
}

function setMightAttack(value) {
    mightAttack = Math.max(0, Math.min(100, value));
    updateAttackWidget();
    updateStagingBar();
}

function updateAttackWidget() {
    const valueEl = document.getElementById('might-attack-value');
    if (valueEl) valueEl.textContent = mightAttack;
    const syncEl = document.getElementById('might-attack-sync');
    if (syncEl) syncEl.style.visibility = (mightLastResult && mightAttack !== mightAttackNatural) ? 'visible' : 'hidden';
    const cardTotalEl = document.getElementById('might-card-total');
    if (cardTotalEl) {
        if (mightLastResult) {
            cardTotalEl.textContent = mightAttackNatural;
            cardTotalEl.style.display = '';
        } else {
            cardTotalEl.style.display = 'none';
        }
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
function updateStagingBar() {
    updateAttackWidget();
    const total   = mightTotalStaged();
    const infoEl  = document.getElementById('might-staged-info');
    const drawBtn = document.getElementById('btn-might-draw');
    if (!infoEl) return;

    const isMiss = mightLastResult && mightLastResult.isMiss;
    const damage = isMiss ? 0 : Math.floor(mightAttack / Math.max(mightDefense, 1));
    const dmgEl  = document.getElementById('might-damage-out');
    if (dmgEl) {
        dmgEl.textContent = S('ui.might_damage').replace('%s', damage);
        dmgEl.classList.toggle('might-damage-out-miss', !!isMiss);
    }

    if (mightLastResult) {
        const sideLabel = mightLastResult.side === 'player' ? S('ui.might_player') : S('ui.might_monster');
        if (mightLastResult.isMiss) {
            infoEl.innerHTML = `<span class="might-result-miss">${sideLabel} ${S('ui.might_miss')}</span>`;
        } else {
            infoEl.innerHTML = `<span class="might-result-label">${sideLabel}</span>`;
        }
    } else {
        infoEl.textContent = S('ui.might_stage_prompt');
    }

    if (drawBtn) drawBtn.disabled = total === 0;
    const drawMoreBtn = document.getElementById('btn-might-draw-more');
    if (drawMoreBtn) drawMoreBtn.disabled = total === 0;
    const clearDrawBtn = document.getElementById('btn-might-clear-draw');
    if (clearDrawBtn) clearDrawBtn.disabled = mightLastDrawCards.length === 0;
    updateLockStates();
}

// Build one drawn-card div. size: 'full' | 'compact' | 'hist'
// index (optional): when provided, adds data-card-index for click-to-disable.
function buildDrawnCardHTML(cardEntry, cfg, size, index) {
    const { value, isCritical, fromCritical } = cardEntry;
    // Criticals keep their parentheses in the display value; no separate star needed.
    const display       = value;
    const isDisabled    = !!cardEntry.disabled;
    const critClass     = isCritical  ? ' is-critical'   : '';
    const chainClass    = fromCritical ? ' from-critical' : '';
    const disabledClass = isDisabled   ? ' card-disabled' : '';
    const sizeClass     = size === 'compact' ? ' card-compact' : size === 'hist' ? ' card-hist' : '';
    const indexAttr     = (index !== undefined) ? ` data-card-index="${index}"` : '';
    const shadowStyle   = isCritical
        ? `box-shadow:0 0 14px ${cfg.critGlow},inset 0 0 6px rgba(255,255,255,0.1)`
        : '';
    const style = [
        `background:${cfg.cardBg}`,
        `border-color:${cfg.cardBorder}`,
        `color:${cfg.cardText}`,
        shadowStyle,
    ].filter(Boolean).join(';');
    const chainDot     = fromCritical  ? `<span class="might-chain-dot"></span>` : '';
    // Always render the X span for full-size cards; CSS show/hide via .card-disabled class.
    const disabledMark = (size === 'full') ? `<span class="might-card-disabled-x">&#10005;</span>` : '';
    const sideLabel    = (size === 'full' && cardEntry.side)
        ? `<span class="might-card-side-label">${cardEntry.side === 'player' ? S('ui.might_player') : S('ui.might_monster')}</span>`
        : '';
    return (
        `<div${indexAttr} class="might-drawn-card${critClass}${chainClass}${disabledClass}${sizeClass}" style="${style}">` +
            chainDot +
            disabledMark +
            `<span class="might-drawn-value">${display}</span>` +
            sideLabel +
        `</div>`
    );
}

function renderHistorySide(side) {
    const bodyEl = document.getElementById(`might-hist-body-${side}`);
    if (!bodyEl) return;

    const entries = mightSessionHistory.filter(s => s.side === side);
    if (entries.length === 0) {
        bodyEl.innerHTML = `<p class="might-hist-empty">${S('ui.might_no_draws')}</p>`;
        return;
    }

    let html = '';
    const reversed = [...entries].reverse();
    reversed.forEach((session, idx) => {
        const isLatest  = idx === 0;
        const drawNum   = entries.length - idx;
        const cardsHtml = session.cards.map(c => buildDrawnCardHTML(c, c.cfg, 'hist')).join('');
        const scoreHtml = session.isMiss
            ? `<span class="might-result-miss">MISS</span><span class="might-result-miss-score"> (${session.total})</span>`
            : `<span class="might-result-total">${session.total}</span>`;
        html += (
            `<div class="might-hist-entry${isLatest ? ' latest' : ''}">` +
                `<div class="might-hist-entry-header">` +
                    `<span class="might-hist-entry-label">${S('ui.might_draw_n').replace('%s', drawNum)}</span>` +
                    scoreHtml +
                `</div>` +
                `<div class="might-hist-entry-cards">${cardsHtml}</div>` +
            `</div>`
        );
    });
    bodyEl.innerHTML = html;
    bodyEl.scrollTop = 0;
}

function renderHistoryModal() {
    renderHistorySide('player');
    renderHistorySide('monster');
}

function renderSharedDrawnArea() {
    const grid = document.getElementById('might-shared-grid');
    if (!grid) return;
    let html = '';
    for (let i = 0; i < mightLastDrawCards.length; i++) {
        html += buildDrawnCardHTML(mightLastDrawCards[i], mightLastDrawCards[i].cfg, 'full', i);
    }
    const padTo = Math.max(MIGHT_DISPLAY_SLOTS, mightLastDrawCards.length);
    for (let i = mightLastDrawCards.length; i < padTo; i++) {
        html += `<div class="might-card-slot-empty"></div>`;
    }
    grid.innerHTML = html;
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
    if (mightTotalStaged() >= MIGHT_MAX_STAGED) return;
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

function handleClearDrawArea() {
    mightLastDrawCards = [];
    mightLastResult    = null;
    mightAttack        = 0;
    mightAttackNatural = 0;
    renderSharedDrawnArea();
    updateStagingBar();
}

function handleToggleCard(index) {
    const card = mightLastDrawCards[index];
    if (!card) return;
    card.disabled = !card.disabled;
    // Toggle the class directly on the existing element - no re-render, no re-animation.
    const el = document.querySelector(`.might-shared-drawn [data-card-index="${index}"]`);
    if (el) el.classList.toggle('card-disabled', card.disabled);
    mightLastResult = computeLiveResult();
    const natural = mightLastResult ? (mightLastResult.isMiss ? 0 : mightLastResult.total) : 0;
    // If attack was in sync with the old natural, keep it in sync with the new one.
    if (mightAttack === mightAttackNatural) mightAttack = natural;
    mightAttackNatural = natural;
    updateStagingBar();
}

function handleDrawMore() {
    const draws = [];
    for (const [key, deck] of Object.entries(mightDecks)) {
        if (deck.staged === 0) continue;
        const round = mightDrawRound(deck, mightSessionId);
        draws.push({ round, side: deck.side, color: deck.color });
        updateDeckDisplay(key);
    }
    if (draws.length === 0) return;

    // Append new cards without re-sorting so existing card elements stay untouched.
    const startIndex = mightLastDrawCards.length;
    for (const { round, color, side } of draws) {
        const cfg = MIGHT_COLOR_CFG[color];
        for (const card of round.cards) {
            mightLastDrawCards.push({ ...card, cfg, color, side, disabled: false });
        }
    }

    // Replace empty slots with new card elements; append beyond 20 if needed.
    const grid = document.getElementById('might-shared-grid');
    if (grid) {
        const emptySlots = Array.from(grid.querySelectorAll('.might-card-slot-empty'));
        let slotIdx = 0;
        for (let i = startIndex; i < mightLastDrawCards.length; i++) {
            const card = mightLastDrawCards[i];
            const tmp  = document.createElement('div');
            tmp.innerHTML = buildDrawnCardHTML(card, card.cfg, 'full', i);
            const newEl = tmp.firstElementChild;
            if (slotIdx < emptySlots.length) {
                emptySlots[slotIdx].replaceWith(newEl);
                slotIdx++;
            } else {
                grid.appendChild(newEl);
            }
        }
    }

    mightLastResult = computeLiveResult();
    const natural = mightLastResult ? (mightLastResult.isMiss ? 0 : mightLastResult.total) : 0;
    if (mightAttack === mightAttackNatural) mightAttack = natural;
    mightAttackNatural = natural;
    updateStagingBar();
}

function handleDraw() {
    mightSessionId++;
    const draws = [];

    for (const [key, deck] of Object.entries(mightDecks)) {
        if (deck.staged === 0) continue;
        const round = mightDrawRound(deck, mightSessionId);
        draws.push({ round, side: deck.side, color: deck.color });
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
        const isMiss = playerInitialBlanks >= 2;
        // Build a flat card list sorted by color order (white, yellow, red, black)
        const sessionCards = [];
        for (const { round, color, side } of draws) {
            const cfg = MIGHT_COLOR_CFG[color];
            for (const card of round.cards) {
                sessionCards.push({ ...card, cfg, color, side, disabled: false });
            }
        }
        sessionCards.sort((a, b) => MIGHT_COLOR_ORDER[a.color] - MIGHT_COLOR_ORDER[b.color]);
        mightLastDrawCards = [...sessionCards];
        mightLastResult = computeLiveResult();
        const natural = mightLastResult ? (mightLastResult.isMiss ? 0 : mightLastResult.total) : 0;
        mightAttack = natural;
        mightAttackNatural = natural;
        renderSharedDrawnArea();
        mightSessionHistory.push({
            sessionId: mightSessionId,
            side: draws[0].side,
            cards: sessionCards,
            total,
            isMiss,
        });
    }

    updateStagingBar();

}

function handleResetAll() {
    for (const key of Object.keys(mightDecks)) {
        mightDecks[key].reset();
        updateDeckDisplay(key);
    }
    mightLastResult    = null;
    mightLastDrawCards = [];
    mightAttack        = 0;
    mightAttackNatural = 0;
    renderSharedDrawnArea();
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
    if (window.applyTranslations) window.applyTranslations();
    updateStagingBar();

    overlay.addEventListener('click', function(e) {
        // Drawn card in shared area: toggle disabled state
        const drawnCard = e.target.closest('.might-shared-drawn [data-card-index]');
        if (drawnCard) { handleToggleCard(parseInt(drawnCard.dataset.cardIndex, 10)); return; }

        const cb = e.target.closest('.might-card-back');
        if (cb) { handleStage(cb.dataset.key); return; }

        const unstageBtn = e.target.closest('.might-btn-unstage');
        if (unstageBtn) { handleUnstage(unstageBtn.dataset.key); return; }

        const stageBtn = e.target.closest('.might-btn-stage');
        if (stageBtn) { handleStage(stageBtn.dataset.key); return; }

        // Attack widget: +/- buttons handled first, then bare widget click = increase
        const atkIncBtn = e.target.closest('.might-btn-atk-inc');
        if (atkIncBtn) { setMightAttack(mightAttack + 1); return; }

        const atkDecBtn = e.target.closest('.might-btn-atk-dec');
        if (atkDecBtn) { setMightAttack(mightAttack - 1); return; }

        const atkWidget = e.target.closest('.might-attack-widget');
        if (atkWidget) { setMightAttack(mightAttack + 1); return; }

        // Defense widget: +/- buttons handled first, then bare widget click = increase
        const defIncBtn = e.target.closest('.might-btn-def-inc');
        if (defIncBtn) { setMightDefense(mightDefense + 1); return; }

        const defDecBtn = e.target.closest('.might-btn-def-dec');
        if (defDecBtn) { setMightDefense(mightDefense - 1); return; }

        const defWidget = e.target.closest('.might-defense-widget');
        if (defWidget) { setMightDefense(mightDefense + 1); return; }
    });

    overlay.addEventListener('contextmenu', function(e) {
        const atkWidget = e.target.closest('.might-attack-widget');
        if (atkWidget) { e.preventDefault(); setMightAttack(mightAttack - 1); return; }

        const defWidget = e.target.closest('.might-defense-widget');
        if (defWidget) { e.preventDefault(); setMightDefense(mightDefense - 1); return; }

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
        if (cb) {
            e.preventDefault();
            if (e.deltaY < 0) { handleStage(cb.dataset.key); }
            else { handleUnstage(cb.dataset.key); }
            return;
        }
        const atkWidget = e.target.closest('.might-attack-widget');
        if (atkWidget) {
            e.preventDefault();
            if (e.deltaY < 0) { setMightAttack(mightAttack + 1); }
            else { setMightAttack(mightAttack - 1); }
            return;
        }
        const defWidget = e.target.closest('.might-defense-widget');
        if (defWidget) {
            e.preventDefault();
            if (e.deltaY < 0) { setMightDefense(mightDefense + 1); }
            else { setMightDefense(mightDefense - 1); }
        }
    }, { passive: false });

    document.getElementById('btn-might-draw').addEventListener('click', handleDraw);
    document.getElementById('btn-might-draw-more').addEventListener('click', handleDrawMore);
    document.getElementById('btn-might-clear-draw').addEventListener('click', handleClearDrawArea);
    document.getElementById('btn-might-history').addEventListener('click', openHistoryModal);
    document.getElementById('btn-might-hist-close').addEventListener('click', closeHistoryModal);
    document.getElementById('btn-might-hist-clear').addEventListener('click', function() {
        mightSessionHistory = [];
        mightLastResult = null;
        updateStagingBar();
        closeHistoryModal();
    });
    document.getElementById('btn-might-reset-all').addEventListener('click', handleResetAll);
    document.getElementById('btn-might-settings').addEventListener('click', function() {
        if (window.openSettingsModal) window.openSettingsModal();
    });
    document.getElementById('btn-might-close').addEventListener('click', closeMightOverlay);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeMightOverlay();
        const modal = document.getElementById('might-hist-modal');
        if (modal && e.target === modal) closeHistoryModal();
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

function openHistoryModal() {
    renderHistoryModal();
    const modal = document.getElementById('might-hist-modal');
    if (modal) modal.style.display = 'flex';
}

function closeHistoryModal() {
    const modal = document.getElementById('might-hist-modal');
    if (modal) modal.style.display = 'none';
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
