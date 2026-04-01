/**
 * main.js - UI logic for the Oathsworn web app.
 * Depends on: game.js, data/strings.js, data/chapters.js, data/images.js
 */

/*
 * TABLE OF CONTENTS  (Ctrl+F the [TAG] to jump to each section)
 *
 *   [CONSTANTS]         AUDIO_BASE, IMAGE_BASE, CHAPTER_ORDER, sentinels
 *   [SETTINGS]          persistent user preferences (localStorage)
 *   [HELPERS]           S(), locationLabel(), imageUrl(), audioUrl()
 *   [SCREEN_ROUTING]    showScreen()
 *   [GAME_STATE]        module-level variables
 *   [HOME]              home screen
 *   [CHAPTER_SELECT]    chapter select screen
 *   [GAME_SCREEN]       startChapter(), loadSection(), updatePathDisplay(), updateClueDisplay()
 *   [RENDER_PLATE]      renderPlate()
 *   [IMAGE_LIGHTBOX]    openImageLightbox()
 *   [RENDER_BUTTONS]    renderButtons()
 *   [BUTTON_HANDLERS]   handleChoiceClick(), handleLocationClick(), advanceAndGo()
 *   [BACK_BUTTON]       back navigation
 *   [GAME_MENU]         exit to chapter select
 *   [AUDIO]             playback, auto-scroll
 *   [SAVE_DATA]         save data viewer screen
 *   [BUG_REPORT]        bug report modal
 *   [I18N]              applyTranslations(), setLanguage(), syncLanguageUI()
 *   [INIT]              document ready, event wiring
 */

//
// ============================================================================
//  [CONSTANTS]
// ============================================================================
//

const AUDIO_BASE = 'data/audio/';
const IMAGE_BASE = 'data/images/';

// Chapter display order (internal chapter numbers)
const CHAPTER_ORDER = [1,2,3,4,5,6,7,8,9,10,11,22,12,13,14,15,16,17,18,19,20,21];

// Chapter display labels (chapter 22 is labelled "11.5")
const CHAPTER_LABELS = {
    22: '11.5'
};

// Short tagline shown on chapter select; edit freely
// Per-chapter art shown in the detail panel; edit freely
const CHAPTER_ART = {
    1:  'data/ui/chapters/ch1_21_1__p4.jpg',
    2:  'data/ui/chapters/ch2_13_4__p2.jpg',
    3:  'data/ui/chapters/ch3_14_1__p2.jpg',
    4:  'data/ui/chapters/ch4_45_1__p1.jpg',
    5:  'data/ui/chapters/ch5_3_11__p1.jpg',
    6:  'data/ui/chapters/ch6ab__p1.jpg',
    7:  'data/ui/chapters/ch7_29_1__p4.jpg',
    8:  'data/ui/chapters/ch8_8_10__p1.jpg',
    9:  'data/ui/chapters/ch11_20_5__p2.jpg',
    10: 'data/ui/chapters/ch10_117_1__p2.jpg',
    11: 'data/ui/chapters/ch11_20_5__p2.jpg',
    22: 'data/ui/chapters/ch11_1_1__p1.jpg',
    12: 'data/ui/chapters/ch11_20_5__p2.jpg',
    13: 'data/ui/chapters/ch13_7_1__p1.jpg',
    14: 'data/ui/chapters/ch14_2_1011__p1.jpg',
    15: 'data/ui/chapters/ch15a_16_2__p1.jpg',
    16: 'data/ui/chapters/ch11_20_5__p2.jpg',
    17: 'data/ui/chapters/ch17.jpg',
    18: 'data/ui/chapters/ch18_1_19__p1.jpg',
    19: 'data/ui/chapters/ch19_1_1__p1.jpg',
    20: 'data/ui/chapters/ch20_0_1__p1.jpg',
    21: 'data/ui/chapters/ch21_1_3__p1.jpg',
};

// Extra inline CSS applied to the chapter detail image div, keyed by chapter number.
// Any valid CSS property string works, e.g. 'filter: hue-rotate(90deg) brightness(0.8)'
const CHAPTER_ART_STYLE = {
    9: 'filter: hue-rotate(45deg)',
    11: 'filter: hue-rotate(90deg)',
    12: 'filter: hue-rotate(125deg)',
    16: 'filter: hue-rotate(180deg)',
};

// Special next-section sentinel values
const NEXT_CHAPTER_END = -1;
const NEXT_DIED = -2;
const NEXT_RETURN_TO_TOKEN = -3;

// Auto-scroll start delay: 15% of total audio duration, clamped to [5, 20] seconds
const SCROLL_START_RATIO = 0.15;
const SCROLL_START_MIN   = 5;
const SCROLL_START_MAX   = 20;

//
// ============================================================================
//  [SETTINGS]
// ============================================================================
//

const SETTINGS_KEY = 'oathsworn_settings';

const SETTINGS_DEFAULTS = {
    autoScroll:         true,
    autoStartNarration: false,
    autoPlayNext:       false,
    language:           'en',
};

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return raw ? Object.assign({}, SETTINGS_DEFAULTS, JSON.parse(raw)) : Object.assign({}, SETTINGS_DEFAULTS);
    } catch (e) {
        return Object.assign({}, SETTINGS_DEFAULTS);
    }
}

function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function syncSettingsUI() {
    document.getElementById('setting-auto-scroll').checked    = settings.autoScroll;
    document.getElementById('setting-auto-narration').checked = settings.autoStartNarration;
    document.getElementById('setting-auto-next').checked      = settings.autoPlayNext;
}

function openSettingsModal() {
    syncSettingsUI();
    populateLanguageSelect();
    $('#settings-modal').css('display', 'flex');
}

let settings = loadSettings();
let activeLanguage = STRINGS[settings.language] ? settings.language : 'en';

//
// ============================================================================
//  [HELPERS]
// ============================================================================
//

// S(key)          - look up a STRINGS key; returns key itself if not found
// S(key, default) - look up a STRINGS key; returns default if not found
function S(key, fallback) {
    const def = arguments.length > 1 ? fallback : key;
    if (!key) return def;
    if (typeof key === 'number') return def;
    const val = (STRINGS[activeLanguage] && STRINGS[activeLanguage][key])
             || (STRINGS['en'] && STRINGS['en'][key]);
    return val !== undefined ? val : def;
}

function locationLabel(locationId) {
    const s = String(locationId);
    const label = s.charAt(1) === '0' ? s.substring(2) : s.substring(1);
    return S('location_starter').replace('%s', label);
}

function imageUrl(name) {
    const ext = IMAGE_EXT[name];
    if (!ext) return null;
    return IMAGE_BASE + name + '.' + ext;
}

function audioUrl(name) {
    if (!name) return null;
    return AUDIO_BASE + name + '.mp3';
}

//
// ============================================================================
//  [SCREEN_ROUTING]
// ============================================================================
//

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

//
// ============================================================================
//  [GAME_STATE]  (module-level, reset on each section load)
// ============================================================================
//

let engine = null;          // current GameEngine
let currentChapterNum = null;
let currentSection = null;  // the Section object
let currentSectionNum = null;
let audioPlayer = null;
let audioTracks = [];           // [url, url, ...] non-null audio tracks for this section
let audioTrackIndex = 0;
let audioTrackDurations = [];   // preloaded durations (seconds) indexed same as audioTracks; null until loaded
let autoScroll = true;
let scrollAnimFrame = null;

//
// ============================================================================
//  [HOME]
// ============================================================================
//

function initHomeScreen() {
    const hasSave = GameState.hasAnyProgress();
    $('#btn-continue-campaign').toggleClass('d-none', !hasSave);
}

$('#btn-new-campaign').on('click', function() {
    if (GameState.hasAnyProgress()) {
        if (!confirm(S('ui.confirm_new_campaign'))) return;
    }
    GameState.clearAll();
    loadChapterSelectScreen();
});

$('#btn-continue-campaign').on('click', function() {
    loadChapterSelectScreen();
});

$('.btn-back-home').on('click', function() {
    stopAudio();
    showScreen('screen-home');
    initHomeScreen();
});

$('#btn-view-save').on('click', function() {
    loadSaveDataScreen();
});

$('#btn-save-back').on('click', function() {
    showScreen('screen-home');
    initHomeScreen();
});

$('#btn-copy-save').on('click', function() {
    const raw = localStorage.getItem(STORAGE_KEY) || '{}';
    navigator.clipboard.writeText(raw).then(() => {
        const btn = document.getElementById('btn-copy-save');
        const orig = btn.textContent;
        btn.textContent = S('ui.copied');
        setTimeout(() => { btn.textContent = orig; }, 1500);
    });
});

//
// ============================================================================
//  [CHAPTER_SELECT]
// ============================================================================
//

let selectedChapterNum = null;

function loadChapterSelectScreen() {
    const list = document.getElementById('chapter-list');
    list.innerHTML = '';

    CHAPTER_ORDER.forEach(chNum => {
        const ch = CHAPTERS[chNum];
        if (!ch) return;

        const label = CHAPTER_LABELS[chNum] || String(chNum);
        const completed = GameState.isChapterCompleted(chNum);
        const started = !completed && GameState.isChapterStarted(chNum);
        const tagline = S('ui.tagline_' + chNum, '');

        const item = document.createElement('button');
        let stateClass = completed ? ' chapter-completed' : (started ? ' chapter-in-progress' : '');
        item.className = 'btn chapter-list-item' + stateClass;
        item.dataset.chapter = chNum;
        item.addEventListener('click', () => selectChapterDetail(chNum));

        const numEl = document.createElement('span');
        numEl.className = 'chapter-list-num';
        numEl.textContent = S('ui.chapter_prefix').replace('%s', label);
        numEl.dataset.stringKey = 'ui.chapter_prefix';
        numEl.dataset.stringParam = label;
        item.appendChild(numEl);

        const tagEl = document.createElement('span');
        tagEl.className = 'chapter-list-tagline';
        tagEl.textContent = tagline;
        tagEl.dataset.stringKey = 'ui.tagline_' + chNum;
        item.appendChild(tagEl);

        list.appendChild(item);
    });

    // Preload all chapter art so image swaps are instant
    Object.values(CHAPTER_ART).forEach(path => { new Image().src = path; });

    // Auto-select the first in-progress chapter, or the first chapter
    const firstInProgress = CHAPTER_ORDER.find(n => !GameState.isChapterCompleted(n) && GameState.isChapterStarted(n));
    selectChapterDetail(firstInProgress || CHAPTER_ORDER[0]);

    showScreen('screen-chapters');
    requestAnimationFrame(updateChapterListFade);
}

function updateChapterListFade() {
    const container = document.getElementById('chapter-list');
    const top    = document.getElementById('chapter-list-fade-top');
    const bottom = document.getElementById('chapter-list-fade-bottom');
    const clippedTop    = container.scrollTop > 2;
    const clippedBottom = container.scrollTop + container.clientHeight < container.scrollHeight - 2;
    if (top)    top.classList.toggle('is-visible', clippedTop);
    if (bottom) bottom.classList.toggle('is-visible', clippedBottom);
}

function selectChapterDetail(chNum) {
    selectedChapterNum = chNum;

    document.querySelectorAll('.chapter-list-item').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.chapter) === chNum);
    });

    const label = CHAPTER_LABELS[chNum] || String(chNum);
    const completed = GameState.isChapterCompleted(chNum);
    const started = !completed && GameState.isChapterStarted(chNum);
    const tagline = S('ui.tagline_' + chNum, '');
    const artPath = CHAPTER_ART[chNum] || null;
    const artExtraStyle = CHAPTER_ART_STYLE[chNum] || '';

    let statusHtml = '';
    if (completed) {
        statusHtml = `<div class="chapter-detail-status chapter-status-completed">${S('ui.chapter_completed')}</div>`;
    } else if (started) {
        statusHtml = `<div class="chapter-detail-status chapter-status-inprogress">${S('ui.chapter_inprogress')}</div>`;
    }

    const btnLabel = started ? S('ui.chapter_resume') : completed ? S('ui.chapter_replay') : S('ui.chapter_start');

    const detail = document.getElementById('chapter-detail');
    detail.innerHTML = `
        <div class="chapter-detail-image" style="${artPath ? `background-image: url('${artPath}'); ` : ''}${artExtraStyle}"></div>
        <div class="chapter-detail-info">
            <div class="chapter-detail-num">${S('ui.chapter_prefix').replace('%s', label)}</div>
            <div class="chapter-detail-tagline">${tagline}</div>
            ${statusHtml}
            <button class="btn btn-primary-game chapter-detail-start" id="btn-chapter-start">${btnLabel}</button>
        </div>
    `;

    document.getElementById('btn-chapter-start').addEventListener('click', () => {
        if (completed) engine.clearCampaign(chNum);
        startChapter(chNum);
    });

    // Fade in the image (starts at 0 via inline style, transitions to 1)
    const imageDiv = detail.querySelector('.chapter-detail-image');
    imageDiv.style.opacity = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => { imageDiv.style.opacity = ''; }));
}

$('#btn-chapters-back').on('click', function() {
    showScreen('screen-home');
    initHomeScreen();
});

//
// ============================================================================
//  [GAME_SCREEN]
// ============================================================================
//

function startChapter(chapterNum) {
    currentChapterNum = chapterNum;
    engine = new GameEngine(chapterNum);
    loadSection(false);
    showScreen('screen-game');
}

function loadSection(goingBack) {
    stopAudio();
    autoScroll = settings.autoScroll;
    $('#autoscroll-paused').addClass('d-none');

    currentSectionNum = engine.getCurrentSectionNum();
    const chapterData = engine.chapterData;
    currentSection = chapterData.sections[currentSectionNum];

    if (!currentSection) {
        console.error('No section data for index', currentSectionNum, 'in chapter', currentChapterNum);
        return;
    }

    // If this is the very first section and we're not going back, call setCurrentSectionNum
    // to initialize state (mirrors Android's onCreate loadSection(false) logic)
    if (currentSectionNum === 0 && !goingBack) {
        engine.setCurrentSectionNum(
            0,
            currentSection.locationsAdded,
            currentSection.clearLocationsList,
            currentSection.removeSpecificLocations,
            chapterData.clue,
            chapterData.clueLocation
        );
    }

    // Time display
    const time = engine.getTime();
    document.getElementById('game-time').textContent = 'TIME: ' + time;
    updatePathDisplay();
    updateClueDisplay();

    // Chapter title (shown only on section 0 first visit)
    const titleArea = document.getElementById('chapter-title-area');
    if (currentSectionNum === 0 && chapterData.num !== 22) {
        const titleKey = 'chapterText' + (chapterData.num === 22 ? '11_5' : chapterData.num);
        const authorKey = 'authorText' + (chapterData.num === 22 ? '11_5' : chapterData.num);
        const titleEl = document.getElementById('chapter-title-text');
        const authorEl = document.getElementById('chapter-author-text');
        titleEl.textContent = S(titleKey) || S('ui.chapter_prefix').replace('%s', CHAPTER_LABELS[chapterData.num] || chapterData.num);
        titleEl.dataset.stringKey = titleKey;
        authorEl.textContent = S(authorKey) || '';
        authorEl.dataset.stringKey = authorKey;
        titleArea.classList.remove('d-none');
    } else {
        titleArea.classList.add('d-none');
    }

    renderPlate();
    renderButtons();
    setupAudio();

    // Scroll content to top
    document.getElementById('game-content').scrollTop = 0;
}

function updatePathDisplay() {
    const path = engine.getActivePath();
    const el = document.getElementById('game-path-label');
    if (path) {
        el.textContent = S('ui.path_label').replace('%s', path);
        el.dataset.stringKey = 'ui.path_label';
        el.dataset.stringParam = path;
        el.classList.remove('d-none');
    } else {
        el.classList.add('d-none');
    }
}

function updateClueDisplay() {
    const tokens = engine.getClueTokens();
    const wrap = document.getElementById('game-clue-tokens');
    wrap.innerHTML = '';
    if (tokens.length === 0) {
        wrap.classList.add('d-none');
        return;
    }
    tokens.forEach(function(n) {
        const tok = document.createElement('div');
        tok.className = 'clue-token';
        tok.textContent = n;
        wrap.appendChild(tok);
    });
    wrap.classList.remove('d-none');
}

//
// ============================================================================
//  [RENDER_PLATE]
// ============================================================================
//

function renderPlate() {
    const section = currentSection;
    const content = document.getElementById('game-content');
    content.innerHTML = '';

    // Build the ordered plate_sections map (key -> item)
    // Even keys: text/popup; odd keys: images
    // Text: key 2, 6, 10, 14
    // Popups: key 4, 8, 12, 16
    // Images: key = position*2 - 1 (positions come from imagePositions array)
    const plate = new Map();

    // Images
    if (section.imageLinks && section.imagePositions) {
        section.imageLinks.forEach((name, i) => {
            const pos = section.imagePositions[i];
            if (pos && name) {
                plate.set(pos * 2 - 1, { type: 'image', name });
            }
        });
    }

    // Text blocks
    const textKeys = [2, 6, 10, 14];
    const textFields = section.sectionTexts || [];
    textFields.forEach((key, i) => {
        if (key) plate.set(textKeys[i], { type: 'text', key });
    });

    // Popup boxes
    const popupKeys = [4, 8, 12, 16];
    (section.popUpTexts || []).forEach((strKey, i) => {
        if (strKey) plate.set(popupKeys[i], { type: 'popup', strKey });
    });

    // Render in sorted key order
    const sorted = [...plate.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, item] of sorted) {
        if (item.type === 'text') {
            const div = document.createElement('div');
            div.className = 'plate-text';
            div.textContent = S(item.key);
            div.dataset.stringKey = item.key;
            content.appendChild(div);
        } else if (item.type === 'popup') {
            const box = document.createElement('div');
            box.className = 'popup-box';
            const icon = document.createElement('img');
            icon.src = 'data/ui/info.png';
            icon.className = 'popup-box-icon';
            icon.alt = '';
            const text = document.createElement('span');
            text.className = 'popup-box-text';
            text.textContent = S(item.strKey);
            text.dataset.stringKey = item.strKey;
            box.appendChild(icon);
            box.appendChild(text);
            content.appendChild(box);
        } else if (item.type === 'image') {
            const url = imageUrl(item.name);
            if (url) {
                const img = document.createElement('img');
                img.src = url;
                img.className = 'plate-image';
                img.alt = '';
                img.addEventListener('click', () => openImageLightbox(url));
                content.appendChild(img);
            }
        }
    }

    applyTranslations();
    requestAnimationFrame(updateContentFade);
}

function updateContentFade() {
    const container = document.getElementById('game-content');
    const top    = document.getElementById('content-fade-top');
    const bottom = document.getElementById('content-fade-bottom');
    const maxScroll = container.scrollHeight - container.clientHeight;
    const ratio = maxScroll > 0 ? container.scrollTop / maxScroll : 0;
    if (top)    top.style.opacity    = ratio * 0.5;
    if (bottom) bottom.style.opacity = (1 - ratio) * 0.5;
}

//
// ============================================================================
//  [IMAGE_LIGHTBOX]
// ============================================================================
//

function openImageLightbox(url) {
    document.getElementById('image-lightbox-img').src = url;
    $('#image-lightbox').css('display', 'flex');
}

//
// ============================================================================
//  [RENDER_BUTTONS]
// ============================================================================
//

function renderButtons() {
    const container = document.getElementById('choice-buttons');
    container.innerHTML = '';

    const section = currentSection;
    const choices = section.choices || [];
    const showLocs = section.showLocations;

    // Choice buttons
    choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-choice w-100';
        btn.textContent = S(choice.text);
        btn.dataset.stringKey = choice.text;
        btn.dataset.next = choice.next;
        btn.addEventListener('click', () => handleChoiceClick(choice.next));
        container.appendChild(btn);
    });

    // Location buttons
    if (showLocs) {
        const locs = engine.getLocationsList();
        locs.forEach(locId => {
            const nextSection = engine.chapterData.location[locId];
            if (nextSection === undefined) return;

            const s = String(locId);
            const locLabel = s.charAt(1) === '0' ? s.substring(2) : s.substring(1);
            const btn = document.createElement('button');
            btn.className = 'btn btn-location w-100';
            btn.textContent = locationLabel(locId);
            btn.dataset.stringKey = 'location_starter';
            btn.dataset.stringParam = locLabel;
            btn.dataset.locId = locId;
            btn.dataset.next = nextSection;
            btn.addEventListener('click', () => handleLocationClick(locId, nextSection));
            container.appendChild(btn);
        });
    }

    applyTranslations();
    requestAnimationFrame(updateScrollHint);
}

function updateScrollHint() {
    const container = document.getElementById('choice-buttons');
    const top    = document.getElementById('choice-fade-top');
    const bottom = document.getElementById('choice-fade-bottom');
    const clippedTop    = container.scrollTop > 2;
    const clippedBottom = container.scrollTop + container.clientHeight < container.scrollHeight - 2;
    if (top)    top.classList.toggle('is-visible',    clippedTop);
    if (bottom) bottom.classList.toggle('is-visible', clippedBottom);
}

//
// ============================================================================
//  [BUTTON_HANDLERS]
// ============================================================================
//

function handleChoiceClick(nextSectionNum) {
    stopAudio();

    if (nextSectionNum === NEXT_CHAPTER_END) {
        // Chapter complete - return to chapter select
        advanceAndGo(nextSectionNum);
        return;
    }

    if (nextSectionNum === NEXT_DIED) {
        engine.diedRestartChapter();
        if (engine.chapterData.deepwoodChapter) {
            engine._setupDeepwood();
        }
        loadSection(false);
        return;
    }

    if (nextSectionNum === NEXT_RETURN_TO_TOKEN) {
        const token = engine.returnToNextPositionToken();
        nextSectionNum = token;
    }

    advanceAndGo(nextSectionNum);
}

function handleLocationClick(locationId, nextSectionNum) {
    stopAudio();

    // Time management for location button uses the same section's timeAdded
    const timeAdded = currentSection.timeAdded;
    engine.manageTime(timeAdded, nextSectionNum);

    // Remove this location from the list
    engine.removeLocation(locationId, engine.chapterData.clueLocation);

    if (nextSectionNum === NEXT_RETURN_TO_TOKEN) {
        nextSectionNum = engine.returnToNextPositionToken();
    } else if (nextSectionNum === NEXT_DIED) {
        engine.diedRestartChapter();
        if (engine.chapterData.deepwoodChapter) engine._setupDeepwood();
        loadSection(false);
        return;
    }

    const nextSection = engine.chapterData.sections[nextSectionNum];
    engine.setCurrentSectionNum(
        nextSectionNum,
        nextSection.locationsAdded,
        nextSection.clearLocationsList,
        nextSection.removeSpecificLocations,
        engine.chapterData.clue,
        engine.chapterData.clueLocation
    );

    currentSectionNum = nextSectionNum;
    currentSection = nextSection;
    loadSection(false);
}

function advanceAndGo(nextSectionNum) {
    if (nextSectionNum === NEXT_CHAPTER_END) {
        // Record that chapter is done then return to chapter select
        GameState.markChapterCompleted(engine.chapterNum);
        loadChapterSelectScreen();
        return;
    }

    // Manage time first
    const redirect = engine.manageTime(currentSection.timeAdded, nextSectionNum);
    const actualNext = redirect !== -1 ? redirect : nextSectionNum;

    const nextSection = engine.chapterData.sections[actualNext];
    if (!nextSection) {
        console.error('No section', actualNext);
        return;
    }

    engine.setCurrentSectionNum(
        actualNext,
        nextSection.locationsAdded,
        nextSection.clearLocationsList,
        nextSection.removeSpecificLocations,
        engine.chapterData.clue,
        engine.chapterData.clueLocation
    );

    currentSectionNum = actualNext;
    currentSection = nextSection;
    loadSection(false);
}

//
// ============================================================================
//  [BACK_BUTTON]
// ============================================================================
//

$('#btn-game-back').on('click', function() {
    if (!confirm(S('ui.confirm_go_back'))) return;
    stopAudio();

    engine.removeCurrentSectionNum(
        currentSection.locationsAdded,
        currentSection.isLocation,
        currentSection.clearLocationsList,
        currentSection.removeSpecificLocations,
        currentSection.timeAdded,
        engine.chapterData.timeList,
        engine.chapterData.clueLocationSectionNum,
        engine.chapterData.clue,
        engine.chapterData.clueLocation
    );

    loadSection(true);
});

//
// ============================================================================
//  [GAME_MENU]
// ============================================================================
//

$('#btn-game-menu').on('click', function() {
    stopAudio();
    loadChapterSelectScreen();
});

//
// ============================================================================
//  [AUDIO]
// ============================================================================
//

function setupAudio() {
    const section = currentSection;
    const rawTracks = section.audio || [null, null, null, null];

    // Build list of non-null tracks
    audioTracks = rawTracks.map(audioUrl).filter(Boolean);
    audioTrackIndex = 0;

    if (audioTracks.length === 0) {
        $('#audio-controls').addClass('invisible');
        return;
    }
    $('#audio-controls').removeClass('invisible');
    // Disable prev/next when there is only one track
    const showNav = audioTracks.length > 1;
    $('#btn-audio-prev, #btn-audio-next').prop('disabled', !showNav);

    // Preload durations for all tracks so the scroll animation can use combined position
    audioTrackDurations = audioTracks.map(() => null);
    audioTracks.forEach((url, i) => {
        const tmp = new Audio();
        tmp.addEventListener('loadedmetadata', () => { audioTrackDurations[i] = tmp.duration; });
        tmp.src = url;
    });

    const isEncounterAudio = rawTracks[0] === 'encounter_audio';
    if (settings.autoStartNarration) {
        playAudioTrack(0, isEncounterAudio);
    } else {
        loadAudioTrack(0, isEncounterAudio);
    }
}

function loadAudioTrack(idx, loop) {
    audioPlayer = document.getElementById('audio-native');
    audioPlayer.src = audioTracks[idx];
    audioPlayer.loop = !!loop;
    audioPlayer.onended = () => {
        if (!audioPlayer.loop && settings.autoPlayNext) {
            audioTrackIndex++;
            if (audioTrackIndex < audioTracks.length) {
                playAudioTrack(audioTrackIndex, false);
            }
        }
    };
    updateTrackLabel();
}

function playAudioTrack(idx, loop) {
    loadAudioTrack(idx, loop);
    playAudio();
}

function playAudio() {
    if (!audioPlayer || audioTracks.length === 0) return;
    audioPlayer.play().catch(() => {});
}

function pauseAudio() {
    if (audioPlayer && !audioPlayer.paused) {
        audioPlayer.pause();
    }
}

function stopAudio() {
    const el = document.getElementById('audio-native');
    if (el) { el.pause(); el.src = ''; el.onended = null; }
    audioPlayer = null;
    audioTrackIndex = 0;
    audioTracks = [];
    audioTrackDurations = [];
}

function startScrollAnimation() {
    if (scrollAnimFrame) return;
    function frame() {
        if (!autoScroll) { scrollAnimFrame = null; return; }
        const audio = document.getElementById('audio-native');
        if (!audio || audio.paused) { scrollAnimFrame = null; return; }
        const dur = audio.duration;
        if (dur && !isNaN(dur)) {
            const content = document.getElementById('game-content');
            const maxScroll = content.scrollHeight - content.clientHeight;
            if (maxScroll > 0) {
                // Use combined position across all tracks if all durations are loaded
                let t, totalDur;
                const allLoaded = audioTrackDurations.length > 0 &&
                    audioTrackDurations.every(d => d !== null);
                if (allLoaded && audioTrackDurations.length > 1) {
                    const elapsedBefore = audioTrackDurations
                        .slice(0, audioTrackIndex)
                        .reduce((sum, d) => sum + d, 0);
                    t = elapsedBefore + audio.currentTime;
                    totalDur = audioTrackDurations.reduce((sum, d) => sum + d, 0);
                } else {
                    t = audio.currentTime;
                    totalDur = dur;
                }
                const startSec = Math.max(SCROLL_START_MIN, Math.min(SCROLL_START_MAX, totalDur * SCROLL_START_RATIO));
                const target = t < startSec ? 0
                    : ((t - startSec) / (totalDur - startSec)) * maxScroll;
                const diff = target - content.scrollTop;
                if (Math.abs(diff) > 0.5) {
                    content.scrollTop += diff * 0.08;
                }
            }
        }
        scrollAnimFrame = requestAnimationFrame(frame);
    }
    scrollAnimFrame = requestAnimationFrame(frame);
}

function stopScrollAnimation() {
    if (scrollAnimFrame) {
        cancelAnimationFrame(scrollAnimFrame);
        scrollAnimFrame = null;
    }
}


function updateTrackLabel() {
    const total = audioTracks.length;
    const label = total > 1 ? S('ui.audio_label').replace('%s', audioTrackIndex + 1).replace('%s', total) : S('ui.audio');
    const el = document.getElementById('audio-track-label');
    if (el) el.textContent = label;
}

$('#btn-audio-prev').on('click', function() {
    if (audioTracks.length === 0) return;
    if (audioPlayer && audioPlayer.currentTime > 2) {
        audioPlayer.currentTime = 0;
        return;
    }
    audioTrackIndex = Math.max(0, audioTrackIndex - 1);
    playAudioTrack(audioTrackIndex, false);
});

$('#btn-audio-next').on('click', function() {
    if (audioTracks.length === 0) return;
    audioTrackIndex = Math.min(audioTracks.length - 1, audioTrackIndex + 1);
    playAudioTrack(audioTrackIndex, false);
});

//
// ============================================================================
//  [SAVE_DATA]
// ============================================================================
//

function loadSaveDataScreen() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const save = raw ? JSON.parse(raw) : { chapters: {} };
    const content = document.getElementById('save-data-content');
    content.innerHTML = '';

    const chapterNums = CHAPTER_ORDER.filter(n => {
        const cs = save.chapters && save.chapters[n];
        return cs && cs.sectionsList && cs.sectionsList.length > 0;
    });

    if (chapterNums.length === 0) {
        const p = document.createElement('p');
        p.style.color = 'var(--color-text-dim)';
        p.textContent = S('ui.no_saved_progress');
        content.appendChild(p);
    } else {
        chapterNums.forEach(chNum => {
            const cs = save.chapters[chNum];
            const label = CHAPTER_LABELS[chNum] || String(chNum);
            const currentSection = cs.sectionsList[cs.sectionsList.length - 1];

            const rows = [
                [S('ui.save_section'), currentSection],
                ['History', S('ui.save_history').replace('%s', cs.sectionsList.length)],
                ['Time', cs.timeTrackList || 0],
                ['Locations', cs.locationsList && cs.locationsList.length ? cs.locationsList.join(', ') : S('ui.save_locations_none')],
            ];

            if (cs.clue1 || cs.clue2) {
                const found = [
                    cs.clue1 && S('ui.save_clue_n').replace('%s', 1),
                    cs.clue2 && S('ui.save_clue_n').replace('%s', 2),
                ].filter(Boolean).join(', ');
                rows.push(['Clues', found]);
            }

            if (cs.unvisitedDeepwoodTokens && cs.unvisitedDeepwoodTokens.length > 0) {
                rows.push([S('ui.save_unvisited_deepwood'), cs.unvisitedDeepwoodTokens.join(', ')]);
            }

            const panel = document.createElement('div');
            panel.className = 'save-data-panel mb-3';

            let html = `<div class="save-data-chapter-label">${S('ui.chapter_prefix').replace('%s', label)}</div>`;
            html += '<table class="save-data-table">';
            rows.forEach(([k, v]) => {
                html += `<tr><td class="save-data-key">${k}</td><td class="save-data-val">${v}</td></tr>`;
            });
            html += '</table>';
            panel.innerHTML = html;
            content.appendChild(panel);
        });
    }

    document.getElementById('save-data-raw').textContent = raw ? JSON.stringify(JSON.parse(raw), null, 2) : '{}';
    showScreen('screen-save-data');
}

//
// ============================================================================
//  [BUG_REPORT]
// ============================================================================
//

function buildBugReportText() {
    const chLabel = CHAPTER_LABELS[currentChapterNum] || String(currentChapterNum);
    const section = currentSection;
    const cd = engine.chapterData;

    // Asset keys for the current section - these encode the storybook entry reference
    const strings  = (section.sectionTexts || []).filter(Boolean);
    const popups   = (section.popUpTexts   || []).filter(Boolean);
    const audio    = (section.audio        || []).filter(Boolean);
    const images   = (section.imageLinks   || []).filter(Boolean);

    // Chapter save state from localStorage
    const raw  = localStorage.getItem(STORAGE_KEY) || '{}';
    const save = JSON.parse(raw);
    const cs   = (save.chapters && save.chapters[currentChapterNum]) || {};

    // Time triggers for this chapter
    const unconditional = JSON.stringify(cd.timeTriggers || {});
    const conditional   = cd.conditionalTimeTriggers
        ? JSON.stringify(cd.conditionalTimeTriggers)
        : 'none';

    const lines = [
        '## Bug Report - Oathsworn Web Companion',
        `**App version:** ${VERSION}`,
        '',
        '**Describe the bug:**',
        '<!-- What went wrong? What did you expect to happen? -->',
        '',
        '---',
        '',
        '### Current position',
        `- Chapter: ${chLabel}`,
        `- Section index (internal): ${currentSectionNum}`,
        `- Story text keys: ${strings.length  ? strings.join(', ')  : 'none'}`,
        `- Popup text keys: ${popups.length   ? popups.join(', ')   : 'none'}`,
        `- Audio keys:      ${audio.length    ? audio.join(', ')    : 'none'}`,
        `- Image keys:      ${images.length   ? images.join(', ')   : 'none'}`,
        '',
        '### Chapter save state',
        `- Time track:                    ${cs.timeTrackList || 0}`,
        `- nextPositionToken:             ${cs.nextPositionToken !== undefined ? cs.nextPositionToken : -1}`,
        `- timeTrackRedirectedSectionNum: ${cs.timeTrackRedirectedSectionNum !== undefined ? cs.timeTrackRedirectedSectionNum : -1}`,
        `- sectionsList:                  [${(cs.sectionsList             || []).join(', ')}]`,
        `- locationsList:                 [${(cs.locationsList            || []).join(', ')}]`,
        `- removedLocationsList:          [${(cs.removedLocationsList     || []).join(', ')}]`,
        `- timeAddedList:                 [${(cs.timeAddedList            || []).join(', ')}]`,
        `- nextPositionTokenWhenTripped:  [${(cs.nextPositionTokenWhenTimeWasTripped || []).join(', ')}]`,
        `- clue1: ${cs.clue1 || false}, clue2: ${cs.clue2 || false}`,
        cd.deepwoodChapter
            ? `- unvisitedDeepwoodTokens: [${(cs.unvisitedDeepwoodTokens || []).join(', ')}]`
            : null,
        '',
        '### Chapter time triggers',
        `- Unconditional: ${unconditional}`,
        `- Conditional:   ${conditional}`,
        '',
        '### Full save data',
        '```json',
        JSON.stringify(save, null, 2),
        '```',
    ].filter(line => line !== null);

    return lines.join('\n');
}

$('#btn-bug-report').on('click', function() {
    $('#bug-report-text').val(buildBugReportText());
    $('#bug-report-modal').css('display', 'flex');
});

$('#btn-bug-modal-close').on('click', function() {
    $('#bug-report-modal').hide();
});

$('#bug-report-modal').on('click', function(e) {
    if (e.target === this) $('#bug-report-modal').hide();
});

$('#btn-bug-copy').on('click', function() {
    const text = document.getElementById('bug-report-text').value;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('btn-bug-copy');
        const orig = btn.textContent;
        btn.textContent = S('ui.copied');
        setTimeout(() => { btn.textContent = orig; }, 1500);
    });
});

//
// ============================================================================
//  [I18N]
// ============================================================================
//

function applyTranslations() {
    const strings = STRINGS[activeLanguage] || STRINGS['en'];
    const en = STRINGS['en'];

    document.querySelectorAll('[data-string-key]').forEach(function(el) {
        const key = el.dataset.stringKey;
        const val = strings[key] || en[key];
        if (!val) return;
        if (el.dataset.stringParam !== undefined) {
            el.textContent = val.replace('%s', el.dataset.stringParam);
        } else {
            el.textContent = val;
        }
    });
}
window.applyTranslations = applyTranslations;
window.openSettingsModal = openSettingsModal;

function setLanguage(lang) {
    activeLanguage = STRINGS[lang] ? lang : 'en';
    settings.language = activeLanguage;
    saveSettings();
    applyTranslations();
    syncLanguageUI();
    // Rebuild dynamic screens that use S() but aren't covered by data-string-key sweeps
    if (selectedChapterNum !== null) selectChapterDetail(selectedChapterNum);
}

function syncLanguageUI() {
    const sel = document.getElementById('setting-language');
    if (sel) sel.value = activeLanguage;
}

function populateLanguageSelect() {
    const sel = document.getElementById('setting-language');
    if (!sel) return;
    sel.innerHTML = '';
    const langs = Object.keys(STRINGS);
    const labels = {
        en: 'English',     de: 'Deutsch',       nl: 'Nederlands',    sv: 'Svenska',
        no: 'Norsk',       da: 'Dansk',          is: '\u00cdslenska', af: 'Afrikaans',
        fr: 'Fran\u00e7ais', es: 'Espa\u00f1ol', it: 'Italiano',     pt: 'Portugu\u00eas',
        ro: 'Rom\u00e2n\u0103', ca: 'Catal\u00e0', gl: 'Galego',
        pl: 'Polski',      cs: '\u010ce\u0161tina', sk: 'Sloven\u010dina',
        ru: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439',
        uk: '\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430',
        bg: '\u0411\u044a\u043b\u0433\u0430\u0440\u0441\u043a\u0438',
        sr: '\u0421\u0440\u043f\u0441\u043a\u0438', hr: 'Hrvatski',  sl: 'Sloven\u0161\u010dina',
        mk: '\u041c\u0430\u043a\u0435\u0434\u043e\u043d\u0441\u043a\u0438',
        lt: 'Lietuvi\u0173', lv: 'Latvie\u0161u', et: 'Eesti',       fi: 'Suomi',
        hu: 'Magyar',      el: '\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac', sq: 'Shqip',
        tr: 'T\u00fcrk\u00e7e', he: '\u05e2\u05d1\u05e8\u05d9\u05ea',
        ar: '\u0639\u0631\u0628\u064a',             fa: '\u0641\u0627\u0631\u0633\u06cc',
        ur: '\u0627\u0631\u062f\u0648',             hi: '\u0939\u093f\u0928\u094d\u062f\u0940',
        bn: '\u09ac\u09be\u0982\u09b2\u09be',
        hy: '\u0540\u0561\u0575\u0565\u0580\u0565\u0576',
        ka: '\u10e5\u10d0\u10e0\u10d7\u10e3\u10da\u10d8',
        kk: '\u049a\u0430\u0437\u0430\u049b', uz: '\u040e\u0437\u0431\u0435\u043a\u0447\u0430',
        ja: '\u65e5\u672c\u8a9e',             ko: '\ud55c\uad6d\uc5b4',
        zh: '\u4e2d\u6587',                   vi: 'Ti\u1ebfng Vi\u1ec7t',
        th: '\u0e44\u0e17\u0e22',             id: 'Bahasa Indonesia', ms: 'Melayu',
    };
    langs.forEach(function(lang) {
        const opt = document.createElement('option');
        opt.value = lang;
        opt.textContent = labels[lang] || lang.toUpperCase();
        sel.appendChild(opt);
    });
    sel.value = activeLanguage;
    // Disable when only one language is available so the row is visible
    // but it's clear there's nothing to switch to yet.
    sel.disabled = langs.length <= 1;
}

//
// ============================================================================
//  [INIT]
// ============================================================================
//

$(function() {
    document.getElementById('app-version').textContent = VERSION;
    applyTranslations();
    initHomeScreen();
    showScreen('screen-home');

    // Load all language files asynchronously. When done, re-evaluate the
    // active language (new files may now be registered) and re-apply so
    // any saved non-English preference takes effect immediately.
    loadLanguageFiles().then(function() {
        activeLanguage = STRINGS[settings.language] ? settings.language : 'en';
        applyTranslations();
    });

    // Start/stop scroll animation based on native audio play/pause
    const audioEl = document.getElementById('audio-native');
    audioEl.addEventListener('play', startScrollAnimation);
    audioEl.addEventListener('pause', stopScrollAnimation);
    audioEl.addEventListener('ended', stopScrollAnimation);

    // Chapter list scroll fades
    const chapterList = document.getElementById('chapter-list');
    chapterList.addEventListener('scroll', updateChapterListFade, { passive: true });
    new ResizeObserver(updateChapterListFade).observe(chapterList);

    // Keep scroll fades in sync as the user scrolls and as layout changes (resize, zoom)
    const choiceButtons = document.getElementById('choice-buttons');
    choiceButtons.addEventListener('scroll', updateScrollHint, { passive: true });
    new ResizeObserver(updateScrollHint).observe(choiceButtons);

    // Disable auto-scroll on genuine user scroll input (wheel/touch only - these
    // never fire from programmatic scrollTop changes)
    function disableAutoScroll() {
        autoScroll = false;
        if (settings.autoScroll) $('#autoscroll-paused').removeClass('d-none');
    }
    const gameContent = document.getElementById('game-content');
    gameContent.addEventListener('wheel', disableAutoScroll, { passive: true });
    gameContent.addEventListener('touchmove', disableAutoScroll, { passive: true });
    gameContent.addEventListener('scroll', updateContentFade, { passive: true });
    new ResizeObserver(updateContentFade).observe(gameContent);

    $('#autoscroll-paused').on('click', function() {
        autoScroll = true;
        $(this).addClass('d-none');
        const audio = document.getElementById('audio-native');
        if (audio && !audio.paused) startScrollAnimation();
    });

    // Settings modal
    $('#btn-settings, #btn-settings-game, #btn-settings-chapters').on('click', openSettingsModal);

    $('#btn-might-home, #btn-might-open').on('click', openMightOverlay);

    $('#btn-settings-close').on('click', function() { $('#settings-modal').hide(); });

    $('#image-lightbox').on('click', function() { $(this).hide(); });

    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $('#image-lightbox').is(':visible')) {
            $('#image-lightbox').hide();
        }
    });

    $('#settings-modal').on('click', function(e) {
        if (e.target === this) $('#settings-modal').hide();
    });

    $('#setting-auto-scroll').on('change', function() {
        settings.autoScroll = this.checked;
        saveSettings();
    });

    $('#setting-auto-narration').on('change', function() {
        settings.autoStartNarration = this.checked;
        saveSettings();
    });

    $('#setting-auto-next').on('change', function() {
        settings.autoPlayNext = this.checked;
        saveSettings();
    });

    $('#setting-language').on('change', function() { setLanguage(this.value); });
});
