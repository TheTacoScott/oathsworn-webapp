/**
 * GameEngine - ports the Android GameTrackers/TimeTrackers classes to JS.
 * State is persisted in localStorage under the key 'oathsworn_save'.
 *
 * Per-chapter state keys mirror the original SharedPreferences keys:
 *   sectionsList, locationsList, removedLocationsList, amountErased,
 *   timeAddedList, nextPositionTokenWhenTimeWasTripped,
 *   nextPositionToken, timeTrackRedirectedSectionNum, timeTrackList,
 *   clue1, clue2, unvisitedDeepwoodTokens
 *
 */

/*
 * TABLE OF CONTENTS  (Ctrl+F the [TAG] to jump to each section)
 *
 *   [STORAGE]       _load(), _save(), _chapterSave(), _getArr/_setArr, _getInt/_setInt, _getBool/_setBool
 *   [NAVIGATION]    getCurrentSectionNum(), setCurrentSectionNum(), removeCurrentSectionNum()
 *   [TIME]          manageTime(), _timePop(), getTime(), returnToNextPositionToken()
 *   [LOCATIONS]     getLocationsList(), removeLocation(), reAddLocation()
 *   [CLUES]         _addAndPopClues(), _removeAndUnPopClues()
 *   [DEEPWOOD]      _setupDeepwood(), _secondDeepwoodVisitRedirect(), _reAddDeepwoodIfBackingOut()
 *   [CAMPAIGN]      diedRestartChapter(), clearCampaign()
 *   [GAME_STATE]    GameState static object (campaign-level helpers)
 */

const STORAGE_KEY = 'oathsworn_save';

class GameEngine {
    constructor(chapterNum) {
        this.chapterNum = chapterNum;
        this.chapterData = CHAPTERS[chapterNum];
        if (!this.chapterData) throw new Error(`No chapter data for chapter ${chapterNum}`);
        if (this.chapterData.deepwoodChapter) {
            this._setupDeepwood();
        }
    }

    //
    // ========================================================================
    //  [STORAGE]
    // ========================================================================
    //

    _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : { chapters: {} };
        } catch (e) {
            return { audioOn: true, chapters: {} };
        }
    }

    _save(data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    _chapterSave(save) {
        const n = this.chapterNum;
        if (!save.chapters) save.chapters = {};
        if (!save.chapters[n]) {
            save.chapters[n] = {
                sectionsList: [],
                locationsList: [],
                removedLocationsList: [],
                amountErased: [],
                timeAddedList: [],
                nextPositionTokenWhenTimeWasTripped: [],
                nextPositionToken: -1,
                timeTrackRedirectedSectionNum: -1,
                timeTrackList: 0,
                clue1: false,
                clue2: false,
                unvisitedDeepwoodTokens: [],
            };
        }
        return save.chapters[n];
    }

    _getArr(key) {
        const save = this._load();
        const cs = this._chapterSave(save);
        return cs[key] || [];
    }

    _setArr(key, arr) {
        const save = this._load();
        const cs = this._chapterSave(save);
        cs[key] = arr;
        this._save(save);
    }

    _getInt(key) {
        const save = this._load();
        const cs = this._chapterSave(save);
        return (cs[key] !== undefined) ? cs[key] : -1;
    }

    _setInt(key, val) {
        const save = this._load();
        const cs = this._chapterSave(save);
        cs[key] = val;
        this._save(save);
    }

    _getBool(key) {
        const save = this._load();
        const cs = this._chapterSave(save);
        return cs[key] === true;
    }

    _setBool(key, val) {
        const save = this._load();
        const cs = this._chapterSave(save);
        cs[key] = val;
        this._save(save);
    }

    //
    // ========================================================================
    //  [NAVIGATION]
    // ========================================================================
    //

    getCurrentSectionNum() {
        const list = this._getArr('sectionsList');
        if (list.length > 0) {
            return list[list.length - 1];
        }
        // First visit: initialize
        const newList = [0];
        this._setArr('sectionsList', newList);
        return 0;
    }

    /**
     * Move forward to a new section. Handles clues, location mutations,
     * deepwood token tracking, and time-triggered redirects.
     */
    setCurrentSectionNum(sectionNum, locationsAdded, clearLocationsList, removeSpecificLocations, clues, clueLocation) {
        let n = sectionNum;

        // Time-track redirect overrides the requested section
        const timeRedirect = this._getInt('timeTrackRedirectedSectionNum');
        if (timeRedirect !== -1) {
            n = timeRedirect;
        }

        // Clue logic (only relevant when clues[0] != -1)
        if (clues && clues[0] !== -1) {
            this._addAndPopClues(n, clues, clueLocation);
        }

        // Remove specific locations
        if (removeSpecificLocations && removeSpecificLocations[0] !== -1) {
            const locList = this._getArr('locationsList');
            for (const loc of removeSpecificLocations) {
                const idx = locList.indexOf(loc);
                if (idx !== -1) {
                    this.removeLocation(loc, clueLocation);
                }
            }
        }

        // Clear all locations if flagged
        if (clearLocationsList) {
            this._clearLocationsList();
        }

        // Add new locations
        if (locationsAdded && locationsAdded[0] !== -1) {
            const locList = this._getArr('locationsList');
            for (const loc of locationsAdded) {
                locList.push(loc);
            }
            locList.sort((a, b) => a - b);
            this._setArr('locationsList', locList);
        }

        // Deepwood: possibly redirect to second-visit section
        if (this.chapterData.deepwoodChapter) {
            const dwRedirect = this._secondDeepwoodVisitRedirect(n);
            if (dwRedirect !== -1) {
                n = dwRedirect;
            }
        }

        // Push to sections history
        const list = this._getArr('sectionsList');
        if (n !== 0) {
            list.push(n);
        }
        this._setArr('sectionsList', list);
    }

    /**
     * Undo the last section (back button). Reverses all state mutations.
     */
    removeCurrentSectionNum(locationsAdded, isLocation, clearLocationsList, removeSpecificLocations,
                            timeAdded, timeList, clueLocationSectionNum, clues, clueLocation) {
        const current = this.getCurrentSectionNum();

        // Undo time
        const timeAddedList = this._getArr('timeAddedList');
        const lastTimeAdded = timeAddedList.length >= 1 ? timeAddedList[timeAddedList.length - 1] : -1;
        if (lastTimeAdded !== -1) {
            this._removeTime(lastTimeAdded);
        }
        if (timeAddedList.length >= 1) {
            timeAddedList.pop();
            this._setArr('timeAddedList', timeAddedList);
        }

        // Deepwood: re-add token if backing out of first deepwood visit
        if (this.chapterData.deepwoodChapter) {
            this._reAddDeepwoodIfBackingOut(current);
        }

        // Clue location: if current section IS the clue location section, re-add it to removedList
        if (current === clueLocationSectionNum) {
            const removedList = this._getArr('removedLocationsList');
            removedList.push(clueLocation);
            this._setArr('removedLocationsList', removedList);
        }

        // Undo clues
        if (clues && clues[0] !== -1) {
            this._removeAndUnPopClues(current, clues, clueLocation);
        }

        // Undo locationsAdded
        if (locationsAdded && locationsAdded[0] !== -1) {
            const locList = this._getArr('locationsList');
            for (const loc of locationsAdded) {
                const idx = locList.indexOf(loc);
                if (idx !== -1) locList.splice(idx, 1);
            }
            this._setArr('locationsList', locList);
        }

        // Undo clearLocationsList
        if (clearLocationsList) {
            this._undoClearLocationsList();
        }

        // Undo removeSpecificLocations
        if (removeSpecificLocations && removeSpecificLocations[0] !== -1) {
            const removedList = this._getArr('removedLocationsList');
            for (const loc of removeSpecificLocations) {
                if (removedList.includes(loc)) {
                    this.reAddLocation();
                }
            }
        }

        // Re-add current location if it was a location tile
        if (isLocation) {
            this.reAddLocation();
        }

        // Re-add locations that were removed due to time-track trips
        const nptWhenTripped = this._getArr('nextPositionTokenWhenTimeWasTripped');
        if (nptWhenTripped.length >= 1 && nptWhenTripped[nptWhenTripped.length - 1] === current) {
            this.reAddLocation();
        }

        // Pop current section from history
        const list = this._getArr('sectionsList');
        if (list.length > 1) {
            list.pop();
            this._setArr('sectionsList', list);
        }
    }

    //
    // ========================================================================
    //  [TIME]
    // ========================================================================
    //

    /**
     * Record time addition and check for time-track triggers.
     * Returns the redirect section (-1 if no trigger).
     */
    manageTime(timeAdded, nextSectionNum) {
        if (timeAdded === -1) {
            this._setInt('timeTrackRedirectedSectionNum', -1);
            return -1;
        }

        // Record in history for back-navigation undo
        const timeAddedList = this._getArr('timeAddedList');
        timeAddedList.push(timeAdded);
        this._setArr('timeAddedList', timeAddedList);

        // Add to time counter
        this._addTime(timeAdded);

        // Save nextPositionToken if on normal path
        if (nextSectionNum !== -3 && this._onNormalPath(nextSectionNum)) {
            this._setInt('nextPositionToken', nextSectionNum);
        }

        // Check for time-track event
        const redirect = this._timePop(timeAdded);
        this._setInt('timeTrackRedirectedSectionNum', redirect);
        return redirect;
    }

    _onNormalPath(sectionNum) {
        const onNP = this.chapterData.onNormalPath;
        if (onNP === 'always') return true;
        if (onNP === 'never') return false;
        if (onNP && onNP.type === 'ranges') {
            for (const [start, end] of onNP.ranges) {
                if (sectionNum >= start && sectionNum <= end) return true;
            }
            return false;
        }
        return true;
    }

    /**
     * Check if adding timeAdded triggered any time-track event.
     * Returns the redirect section index, or -1 if no trigger.
     * NOTE: addTime must be called before this.
     */
    _timePop(timeAdded) {
        if (timeAdded <= 0) return -1;
        const currentTime = this.getTime(); // already includes timeAdded
        let time = currentTime - timeAdded;

        for (let unit = 1; unit <= timeAdded; unit++) {
            time++;
            const trigger = this.chapterData.timeTriggers[time];
            if (trigger !== undefined) {
                return trigger;
            }
        }
        return -1;
    }

    _addTime(amount) {
        const current = this._getInt('timeTrackList') || 0;
        this._setInt('timeTrackList', current + amount);
    }

    _removeTime(amount) {
        const current = this._getInt('timeTrackList') || 0;
        const next = (current >= amount - 1) ? current - amount : 0;
        this._setInt('timeTrackList', next);
    }

    getTime() {
        return this._getInt('timeTrackList') || 0;
    }

    returnToNextPositionToken() {
        return this._getInt('nextPositionToken');
    }

    //
    // ========================================================================
    //  [LOCATIONS]
    // ========================================================================
    //

    getLocationsList() {
        return this._getArr('locationsList');
    }

    removeLocation(locationId, clueLocation) {
        const locList = this._getArr('locationsList');
        const removedList = this._getArr('removedLocationsList');
        const nptTripped = this._getArr('nextPositionTokenWhenTimeWasTripped');

        const idx = locList.indexOf(locationId);
        if (idx !== -1) locList.splice(idx, 1);

        if (locationId !== clueLocation) {
            removedList.push(locationId);
            nptTripped.push(this._getInt('timeTrackRedirectedSectionNum'));
        }

        this._setArr('locationsList', locList);
        this._setArr('removedLocationsList', removedList);
        this._setArr('nextPositionTokenWhenTimeWasTripped', nptTripped);
    }

    reAddLocation() {
        const locList = this._getArr('locationsList');
        const removedList = this._getArr('removedLocationsList');
        const nptTripped = this._getArr('nextPositionTokenWhenTimeWasTripped');

        if (removedList.length > 0) {
            locList.push(removedList.pop());
            if (nptTripped.length > 0) nptTripped.pop();
        }

        locList.sort((a, b) => a - b);
        this._setArr('locationsList', locList);
        this._setArr('removedLocationsList', removedList);
        this._setArr('nextPositionTokenWhenTimeWasTripped', nptTripped);
    }

    _clearLocationsList() {
        const locList = this._getArr('locationsList');
        const amountErased = this._getArr('amountErased');
        const removedList = this._getArr('removedLocationsList');

        amountErased.push(locList.length);
        for (const loc of locList) removedList.push(loc);
        locList.length = 0;

        this._setArr('locationsList', locList);
        this._setArr('amountErased', amountErased);
        this._setArr('removedLocationsList', removedList);
    }

    _undoClearLocationsList() {
        const locList = this._getArr('locationsList');
        const amountErased = this._getArr('amountErased');
        const removedList = this._getArr('removedLocationsList');

        if (amountErased.length === 0) return;
        const count = amountErased.pop();
        for (let i = 0; i < count; i++) {
            if (removedList.length > 0) locList.push(removedList.pop());
        }
        locList.sort((a, b) => a - b);

        this._setArr('locationsList', locList);
        this._setArr('amountErased', amountErased);
        this._setArr('removedLocationsList', removedList);
    }

    //
    // ========================================================================
    //  [CLUES]
    // ========================================================================
    //

    _addAndPopClues(sectionNum, clues, clueLocation) {
        if (sectionNum === clues[0]) this._setBool('clue1', true);
        if (sectionNum === clues[1]) this._setBool('clue2', true);

        if ((sectionNum === clues[0] || sectionNum === clues[1]) &&
            this._getBool('clue1') && this._getBool('clue2')) {
            const locList = this._getArr('locationsList');
            locList.push(clueLocation);
            locList.sort((a, b) => a - b);
            this._setArr('locationsList', locList);
        }
    }

    _removeAndUnPopClues(sectionNum, clues, clueLocation) {
        if (sectionNum === clues[0]) {
            if (this._getBool('clue1') && this._getBool('clue2')) {
                this.removeLocation(clueLocation, clueLocation);
            }
            this._setBool('clue1', false);
        }
        if (sectionNum === clues[1]) {
            if (this._getBool('clue1') && this._getBool('clue2')) {
                this.removeLocation(clueLocation, clueLocation);
            }
            this._setBool('clue2', false);
        }
    }

    //
    // ========================================================================
    //  [DEEPWOOD]
    // ========================================================================
    //

    _setupDeepwood() {
        const save = this._load();
        const cs = this._chapterSave(save);
        if (!cs.unvisitedDeepwoodTokens || cs.unvisitedDeepwoodTokens.length === 0) {
            cs.unvisitedDeepwoodTokens = [...this.chapterData.deepwoodTokens];
            this._save(save);
        }
    }

    /**
     * If the requested section is a deepwood token that has already been visited,
     * redirect to its second-visit section. Also remove the last section from
     * unvisitedDeepwoodTokens if it was a deepwood token.
     * Returns the (possibly redirected) section num, or -1 on error.
     */
    _secondDeepwoodVisitRedirect(sectionNum) {
        const unvisited = this._getArr('unvisitedDeepwoodTokens');
        const sections = this._getArr('sectionsList');
        const allTokens = this.chapterData.deepwoodTokens;
        const deepwoodMap = this.chapterData.deepwoodMap;

        let n = sectionNum;

        // If this token was already visited, redirect to second-visit section
        if (allTokens.includes(n) && !unvisited.includes(n)) {
            const redirect = deepwoodMap[n];
            n = (redirect !== undefined) ? redirect : -1;
        }

        // If the last visited section was a deepwood token, mark it visited
        if (sections.length >= 1) {
            const lastSection = sections[sections.length - 1];
            if (allTokens.includes(lastSection) && unvisited.includes(lastSection)) {
                const idx = unvisited.indexOf(lastSection);
                unvisited.splice(idx, 1);
                this._setArr('unvisitedDeepwoodTokens', unvisited);
            }
        }

        return n;
    }

    _reAddDeepwoodIfBackingOut(currentSection) {
        const sections = this._getArr('sectionsList');
        if (sections.length < 2) return;

        const prevSection = sections[sections.length - 2];
        const allTokens = this.chapterData.deepwoodTokens;

        if (allTokens.includes(prevSection)) {
            const unvisited = this._getArr('unvisitedDeepwoodTokens');
            if (!unvisited.includes(prevSection)) {
                unvisited.push(prevSection);
                this._setArr('unvisitedDeepwoodTokens', unvisited);
            }
        }
    }

    //
    // ========================================================================
    //  [CAMPAIGN]
    // ========================================================================
    //

    diedRestartChapter() {
        this.clearCampaign(this.chapterNum);
        return 0;
    }

    clearCampaign(chapterNum) {
        const save = this._load();
        if (!save.chapters) save.chapters = {};
        save.chapters[chapterNum] = {
            sectionsList: [0],
            locationsList: [],
            removedLocationsList: [],
            amountErased: [],
            timeAddedList: [],
            nextPositionTokenWhenTimeWasTripped: [],
            nextPositionToken: -1,
            timeTrackRedirectedSectionNum: -1,
            timeTrackList: 0,
            clue1: false,
            clue2: false,
            unvisitedDeepwoodTokens: [],
        };
        this._save(save);
    }

}

//
// ============================================================================
//  [GAME_STATE]
// ============================================================================
//

const GameState = {
    _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : { chapters: {} };
        } catch (e) {
            return { audioOn: true, chapters: {} };
        }
    },

    _save(data) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    },

    hasAnyProgress() {
        const save = this._load();
        if (!save.chapters) return false;
        for (const chNum of Object.keys(CHAPTERS)) {
            const cs = save.chapters[chNum];
            if (cs && cs.sectionsList && cs.sectionsList.length > 0 &&
                !(cs.sectionsList.length === 1 && cs.sectionsList[0] === 0)) {
                return true;
            }
        }
        return false;
    },

    getChapterProgress(chapterNum) {
        const save = this._load();
        const cs = save.chapters && save.chapters[chapterNum];
        if (!cs || !cs.sectionsList || cs.sectionsList.length === 0) return 0;
        return cs.sectionsList[cs.sectionsList.length - 1];
    },

    isChapterStarted(chapterNum) {
        const progress = this.getChapterProgress(chapterNum);
        return progress !== 0;
    },

    clearAll() {
        const save = this._load();
        save.chapters = {};
        this._save(save);
    },

};
