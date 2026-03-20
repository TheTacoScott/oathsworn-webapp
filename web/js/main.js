/**
 * main.js - UI logic for the Oathsworn web app.
 * Depends on: game.js, data/strings.js, data/chapters.js, data/images.js
 */

/*
 * TABLE OF CONTENTS  (Ctrl+F the [TAG] to jump to each section)
 *
 *   [CONSTANTS]         AUDIO_BASE, IMAGE_BASE, CHAPTER_ORDER, sentinels
 *   [HELPERS]           S(), locationLabel(), imageUrl(), audioUrl()
 *   [SCREEN_ROUTING]    showScreen()
 *   [GAME_STATE]        module-level variables
 *   [HOME]              home screen
 *   [CHAPTER_SELECT]    chapter select screen
 *   [GAME_SCREEN]       startChapter(), loadSection()
 *   [RENDER_PLATE]      renderPlate()
 *   [RENDER_BUTTONS]    renderButtons()
 *   [BUTTON_HANDLERS]   handleChoiceClick(), handleLocationClick(), advanceAndGo()
 *   [BACK_BUTTON]       back navigation
 *   [GAME_MENU]         exit to chapter select
 *   [AUDIO]             playback, auto-scroll
 *   [SAVE_DATA]         save data viewer screen
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

// Special next-section sentinel values
const NEXT_CHAPTER_END = -1;
const NEXT_DIED = -2;
const NEXT_RETURN_TO_TOKEN = -3;

// Seconds into audio playback before auto-scroll begins
const AUDIO_SCROLL_START_SEC = 10;

//
// ============================================================================
//  [HELPERS]
// ============================================================================
//

function S(key) {
    if (!key) return '';
    if (typeof key === 'number') return '';
    return STRINGS[key] || key;
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
let audioTracks = [];       // [url, url, ...] non-null audio tracks for this section
let audioTrackIndex = 0;
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
        if (!confirm('Are you sure you want to start a new campaign? This will DELETE any saved progress.')) return;
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
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
    });
});

//
// ============================================================================
//  [CHAPTER_SELECT]
// ============================================================================
//

function loadChapterSelectScreen() {
    const grid = document.getElementById('chapter-grid');
    grid.innerHTML = '';

    CHAPTER_ORDER.forEach(chNum => {
        const ch = CHAPTERS[chNum];
        if (!ch) return;

        const label = CHAPTER_LABELS[chNum] || String(chNum);
        const started = GameState.isChapterStarted(chNum);

        const col = document.createElement('div');
        col.className = 'col';

        const btn = document.createElement('button');
        btn.className = 'btn w-100 chapter-btn' + (started ? ' chapter-started' : '');
        btn.textContent = label;
        btn.dataset.chapter = chNum;
        btn.addEventListener('click', () => startChapter(chNum));

        col.appendChild(btn);
        grid.appendChild(col);
    });

    showScreen('screen-chapters');
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
    autoScroll = true;
    const cb = document.getElementById('auto-scroll-check');
    if (cb) cb.checked = true;

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

    // Chapter title (shown only on section 0 first visit)
    const titleArea = document.getElementById('chapter-title-area');
    if (currentSectionNum === 0 && chapterData.num !== 22) {
        const titleKey = 'chapterText' + (chapterData.num === 22 ? '11_5' : chapterData.num);
        const authorKey = 'authorText' + (chapterData.num === 22 ? '11_5' : chapterData.num);
        document.getElementById('chapter-title-text').textContent = S(titleKey) || ('Chapter ' + (CHAPTER_LABELS[chapterData.num] || chapterData.num));
        document.getElementById('chapter-author-text').textContent = S(authorKey) || '';
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
            content.appendChild(div);
        } else if (item.type === 'popup') {
            const box = document.createElement('div');
            box.className = 'popup-box';
            box.textContent = S(item.strKey);
            content.appendChild(box);
        } else if (item.type === 'image') {
            const url = imageUrl(item.name);
            if (url) {
                const img = document.createElement('img');
                img.src = url;
                img.className = 'plate-image w-100';
                img.alt = '';
                content.appendChild(img);
            }
        }
    }
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

            const btn = document.createElement('button');
            btn.className = 'btn btn-location w-100';
            btn.textContent = locationLabel(locId);
            btn.dataset.locId = locId;
            btn.dataset.next = nextSection;
            btn.addEventListener('click', () => handleLocationClick(locId, nextSection));
            container.appendChild(btn);
        });
    }
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
    if (!confirm('Are you sure you want to go back?')) return;
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
    // Show prev/next only when there are multiple tracks
    const showNav = audioTracks.length > 1;
    $('#btn-audio-prev, #btn-audio-next').toggleClass('d-none', !showNav);

    const isEncounterAudio = rawTracks[0] === 'encounter_audio';
    playAudioTrack(0, isEncounterAudio);
}

function loadAudioTrack(idx, loop) {
    audioPlayer = document.getElementById('audio-native');
    audioPlayer.src = audioTracks[idx];
    audioPlayer.loop = !!loop;
    audioPlayer.onended = () => {
        if (!audioPlayer.loop) {
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
                const t = audio.currentTime;
                const target = t < AUDIO_SCROLL_START_SEC ? 0
                    : ((t - AUDIO_SCROLL_START_SEC) / (dur - AUDIO_SCROLL_START_SEC)) * maxScroll;
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
    const label = total > 1 ? 'Track ' + (audioTrackIndex + 1) + ' / ' + total : 'Audio';
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
        p.textContent = 'No saved progress found.';
        content.appendChild(p);
    } else {
        chapterNums.forEach(chNum => {
            const cs = save.chapters[chNum];
            const label = CHAPTER_LABELS[chNum] || String(chNum);
            const currentSection = cs.sectionsList[cs.sectionsList.length - 1];

            const rows = [
                ['Section', currentSection],
                ['History', cs.sectionsList.length + ' sections visited'],
                ['Time', cs.timeTrackList || 0],
                ['Locations', cs.locationsList && cs.locationsList.length ? cs.locationsList.join(', ') : 'none'],
            ];

            if (cs.clue1 || cs.clue2) {
                const found = [cs.clue1 && 'Clue 1', cs.clue2 && 'Clue 2'].filter(Boolean).join(', ');
                rows.push(['Clues', found]);
            }

            if (cs.unvisitedDeepwoodTokens && cs.unvisitedDeepwoodTokens.length > 0) {
                rows.push(['Unvisited Deepwood', cs.unvisitedDeepwoodTokens.join(', ')]);
            }

            const panel = document.createElement('div');
            panel.className = 'save-data-panel mb-3';

            let html = `<div class="save-data-chapter-label">Chapter ${label}</div>`;
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
//  [INIT]
// ============================================================================
//

$(function() {
    initHomeScreen();
    showScreen('screen-home');

    // Start/stop scroll animation based on native audio play/pause
    const audioEl = document.getElementById('audio-native');
    audioEl.addEventListener('play', startScrollAnimation);
    audioEl.addEventListener('pause', stopScrollAnimation);
    audioEl.addEventListener('ended', stopScrollAnimation);

    // Disable auto-scroll on genuine user scroll input (wheel/touch only - these
    // never fire from programmatic scrollTop changes)
    function disableAutoScroll() {
        autoScroll = false;
        const cb = document.getElementById('auto-scroll-check');
        if (cb) cb.checked = false;
    }
    const gameContent = document.getElementById('game-content');
    gameContent.addEventListener('wheel', disableAutoScroll, { passive: true });
    gameContent.addEventListener('touchmove', disableAutoScroll, { passive: true });

    $('#auto-scroll-check').on('change', function() {
        autoScroll = this.checked;
        if (autoScroll) {
            const audio = document.getElementById('audio-native');
            if (audio && !audio.paused) startScrollAnimation();
        }
    });
});
