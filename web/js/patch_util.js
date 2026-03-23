/**
 * patch_util.js
 *
 * Utility functions for patching chapter data after it has been generated.
 * Load this file after game.js and before patches.js.
 *
 * There are two kinds of patches:
 *
 *   1. DATA PATCHES  - directly overwrite fields on CHAPTERS[n].
 *      These are straightforward and need no special runtime support.
 *
 *   2. CONDITIONAL TIME TRIGGERS - time track events that only fire
 *      when the player is on a specific story path (tracked via
 *      nextPositionToken). These require a small runtime hook that
 *      is installed automatically when this file loads.
 *
 * See patches.js for concrete usage examples.
 */


// =============================================================================
//  DATA PATCHES
// =============================================================================

/**
 * Set the sections that count as "on the normal narrative path".
 *
 * The engine uses this to decide whether to save nextPositionToken when
 * the player advances. Only sections on the normal path are saved; time-
 * triggered journal/event sections are not, so that "return to token"
 * choices land the player back at their last real story position.
 *
 * ranges: array of [firstSection, lastSection] pairs (inclusive).
 *   Use Infinity as the upper bound for an open-ended range.
 *
 * Example:
 *   patchOnNormalPath(4, [
 *     [0,  57],         // main narrative
 *     [90, 124],        // deepwood second-visit sections
 *   ]);
 */
function patchOnNormalPath(chapterNum, ranges) {
    if (!CHAPTERS[chapterNum]) {
        console.warn('patchOnNormalPath: chapter ' + chapterNum + ' not found');
        return;
    }
    CHAPTERS[chapterNum].onNormalPath = { type: 'ranges', ranges: ranges };
}


/**
 * Add or replace a simple (unconditional) time trigger.
 *
 * At the given time-track value, all players are redirected to targetSection,
 * regardless of which story path they are on.
 *
 * Example:
 *   patchTimeTrigger(13, 11, 116);  // at time 11, go to section 116
 */
function patchTimeTrigger(chapterNum, timeIndex, targetSection) {
    if (!CHAPTERS[chapterNum]) {
        console.warn('patchTimeTrigger: chapter ' + chapterNum + ' not found');
        return;
    }
    CHAPTERS[chapterNum].timeTriggers[timeIndex] = targetSection;
}


/**
 * Remove a time trigger entirely (useful before replacing it with a
 * conditional trigger, or to delete one that was generated incorrectly).
 *
 * Example:
 *   patchRemoveTimeTrigger(15, 5);
 */
function patchRemoveTimeTrigger(chapterNum, timeIndex) {
    if (!CHAPTERS[chapterNum]) {
        console.warn('patchRemoveTimeTrigger: chapter ' + chapterNum + ' not found');
        return;
    }
    delete CHAPTERS[chapterNum].timeTriggers[timeIndex];
}


/**
 * Patch individual fields on a section object.
 *
 * Accepts a plain object whose keys will be merged (shallowly) into the
 * existing section. Useful for fixing a single field without rewriting the
 * whole section.
 *
 * Example:
 *   patchSection(2, 45, { timeAdded: 1 });
 *   patchSection(1,  0, { choices: [{ text: 'btn_continue', next: 1 }] });
 */
function patchSection(chapterNum, sectionIndex, overrides) {
    const chapter = CHAPTERS[chapterNum];
    if (!chapter) {
        console.warn('patchSection: chapter ' + chapterNum + ' not found');
        return;
    }
    const section = chapter.sections[sectionIndex];
    if (!section) {
        console.warn('patchSection: chapter ' + chapterNum + ' section ' + sectionIndex + ' not found');
        return;
    }
    Object.assign(section, overrides);
}


/**
 * Patch a top-level metadata field on a chapter (anything except "sections").
 *
 * Example:
 *   patchChapterMeta(1, 'clue', [25, 26]);
 *   patchChapterMeta(10, 'deepwoodChapter', true);
 */
function patchChapterMeta(chapterNum, field, value) {
    if (!CHAPTERS[chapterNum]) {
        console.warn('patchChapterMeta: chapter ' + chapterNum + ' not found');
        return;
    }
    CHAPTERS[chapterNum][field] = value;
}


// =============================================================================
//  CONDITIONAL TIME TRIGGERS
// =============================================================================
//
// Some chapters have story paths (A and B). When the time track fires, the
// redirect destination depends on which path the player is currently on.
// The engine tracks this via nextPositionToken: the section index of the last
// "normal path" section the player visited.
//
// A conditional time trigger describes the rule as:
//   "at time N, if the player's position token matches <condition>, go to
//    section <goTo>."
//
// CONDITION FIELDS (all optional; any matching field fires the trigger):
//
//   whenTokenInRange:    [min, max]   - fires when min <= nextPositionToken <= max
//   whenTokenNotInRange: [min, max]   - fires when nextPositionToken < min OR > max
//   orTokenIs:           [v, ...]     - additional exact token values that also fire
//                                       (used alongside whenTokenInRange)
//
// These are evaluated as:
//   (whenTokenInRange matches)  OR  (whenTokenNotInRange matches)  OR  (orTokenIs matches)
//
// orTokenIs is intended to be combined with whenTokenInRange to add special
// "extra" sections that belong to the same path but sit outside the main range.
//
// EXAMPLES:
//
//   Path B trigger (sections 64-143, plus special section 145):
//     { goTo: 71, whenTokenInRange: [64, 143], orTokenIs: [145] }
//
//   Path A trigger (sections 0-44, plus special section 99):
//     { goTo: 33, whenTokenInRange: [0, 44], orTokenIs: [99] }
//
//   Path A trigger (everything that is NOT path B):
//     { goTo: 33, whenTokenNotInRange: [106, 218] }


/**
 * Add a conditional time trigger for a chapter.
 *
 * If the chapter already has a plain (unconditional) timeTrigger for this
 * time index it will be removed, since the conditional version replaces it.
 *
 * condition: see format documented above.
 *
 * Example:
 *   patchConditionalTimeTrigger(7, 9, {
 *     goTo: 71,
 *     whenTokenInRange: [64, 143],
 *     orTokenIs: [145],
 *   });
 */
function patchConditionalTimeTrigger(chapterNum, timeIndex, condition) {
    const chapter = CHAPTERS[chapterNum];
    if (!chapter) {
        console.warn('patchConditionalTimeTrigger: chapter ' + chapterNum + ' not found');
        return;
    }

    // Remove any conflicting unconditional trigger for this time index.
    delete chapter.timeTriggers[timeIndex];

    if (!chapter.conditionalTimeTriggers) {
        chapter.conditionalTimeTriggers = {};
    }
    chapter.conditionalTimeTriggers[timeIndex] = condition;
}


// Note: the runtime logic that evaluates conditionalTimeTriggers lives in
// game.js (_timeTriggerConditionMatches and the _timePop method).
// patch_util.js only writes data; it has no runtime hooks of its own.
