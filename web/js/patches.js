/**
 * patches.js
 *
 * Hand-authored corrections for bugs that generate_data.py produces when
 * parsing the decompiled Android source. Run after all chapter_N.js files
 * and after patch_util.js.
 *
 * See patch_util.js for documentation on patchOnNormalPath(),
 * patchConditionalTimeTrigger(), patchSection(), etc.
 *
 * Two categories of bugs are fixed here:
 *
 *   BUG A - onNormalPath wrong for deepwood chapters (4, 10, 14, 17)
 *     JADX failed to decompile the onNormalPath() method in four GT files
 *     and fell back to a bytecode dump. The generator script looks for
 *     "return true" / "return false" strings, finds neither in the dump,
 *     and defaults to "always". The correct ranges were decoded by hand
 *     from the bytecode.
 *
 *   BUG B - Path-conditional time triggers missing or wrong (ch 2, 5, 7, 9, 15)
 *     Chapters 2, 5, 7, 9, and 15 each split into two story paths (A and B).
 *     Some time-track events should only redirect path-A players; others only
 *     path-B players. Two sub-bugs produced wrong data:
 *
 *       B1 - JADX failure: four time methods throw UnsupportedOperationException
 *            so the generator finds no return value and omits the trigger entirely.
 *            Affected: ch2 time8, ch5 time10, ch7 time9, ch9 time10.
 *
 *       B2 - Non-greedy regex: the generator matches the FIRST "return N;" in
 *            a method. For path-guarded methods the first return is "return -1;"
 *            (the guard for the other path), so the real trigger section is never
 *            captured. Affected: ch2 time12, ch7 time14, ch15 time10.
 *
 *     All of these are replaced with conditional time triggers that check
 *     nextPositionToken at trigger time to decide which path the player is on.
 *
 *     Additionally ch15 time5 was captured as an unconditional trigger (195) by
 *     B2's accidental luck - the "return 195" happened to come before "return -1"
 *     in that specific method - but it should also be conditional (path B only).
 */


// =============================================================================
//  BUG A: onNormalPath corrections
//
//  The onNormalPath property tells the engine which section numbers represent
//  the player's "real story position" for the purpose of saving nextPositionToken.
//  Time-triggered journal/event sections should NOT update nextPositionToken, so
//  that "return to token" choices navigate back to the last narrative section.
//
//  Ranges were decoded by hand from JADX bytecode comments in each GT*.java file.
// =============================================================================

// --- Chapter 4 ---
// Normal narrative sections: 0-57
// Time-triggered journal entries: 58-89  (should NOT update nextPositionToken)
// Deepwood second-visit sections: 90-124 (ARE on normal path for deepwood tracking)
patchOnNormalPath(4, [
    [0,  57],
    [90, 124],
]);

// --- Chapter 10 ---
// Normal narrative sections: 0-136
// Time-triggered journal entries: 137-198  (should NOT update nextPositionToken)
// Additional normal-path sections: 199-250
patchOnNormalPath(10, [
    [0,   136],
    [199, 250],
]);

// --- Chapter 14 ---
// Normal narrative sections: 0-149
// Time-triggered sections: 150-161  (should NOT update nextPositionToken)
// Remaining sections 162+ are back on normal path
patchOnNormalPath(14, [
    [0,   149],
    [162, Infinity],
]);

// --- Chapter 17 ---
// Normal narrative sections: 0-100
// Time-triggered journal entries: 101-138  (should NOT update nextPositionToken)
// Remaining sections 139+ are back on normal path
patchOnNormalPath(17, [
    [0,   100],
    [139, Infinity],
]);


// =============================================================================
//  BUG B: Path-conditional time triggers
//
//  For chapters with two story paths (A and B), time-track events redirect to
//  different sections depending on which path the player is on at trigger time.
//  The engine tracks current path via nextPositionToken (the last section the
//  player visited that was on the normal narrative path).
//
//  Each patch below names the source method and the redirect section it found
//  in the JADX bytecode or decompiled Java.
// =============================================================================


// -----------------------------------------------------------------------------
// Chapter 2 - path boundary: endOfPathA = 44, startOfPathB = 45, endOfPathB = 85
//   additionalPathA = 99  (location-select hub for path A)
//   additionalPathB = 100 (location-select hub for path B)
// -----------------------------------------------------------------------------

// GT2.time8() [JADX failure - B1]: path B players -> section 66 (2b_30_1)
patchConditionalTimeTrigger(2, 8, {
    goTo: 66,
    whenTokenInRange: [45, 85],
    orTokenIs: [100],
});

// GT2.time12() [early return -1 - B2]: path A players -> section 33 (2a_40_1)
patchConditionalTimeTrigger(2, 12, {
    goTo: 33,
    whenTokenInRange: [0, 44],
    orTokenIs: [99],
});


// -----------------------------------------------------------------------------
// Chapter 5 - path boundary: startOfPathB = 49, endOfPathB = 96
//   additionalPathB = [101, 102, 104]  (extra path-B sections outside the range)
// -----------------------------------------------------------------------------

// GT5.time10() [JADX failure - B1]: path B players -> section 93 (5b_30_1)
patchConditionalTimeTrigger(5, 10, {
    goTo: 93,
    whenTokenInRange: [49, 96],
    orTokenIs: [101, 102, 104],
});


// -----------------------------------------------------------------------------
// Chapter 7 - path boundary: endOfPathA = 63, startOfPathB = 64, endOfPathB = 143
//   additionalPathA = 144  (extra path-A section outside the main range)
//   additionalPathB = 145  (extra path-B section outside the main range)
// -----------------------------------------------------------------------------

// GT7.time9() [JADX failure - B1]: path B players -> section 71 (7b_12_20)
patchConditionalTimeTrigger(7, 9, {
    goTo: 71,
    whenTokenInRange: [64, 143],
    orTokenIs: [145],
});

// GT7.time14() [early return -1 - B2]: path A players -> section 63 (7a_30_3)
patchConditionalTimeTrigger(7, 14, {
    goTo: 63,
    whenTokenInRange: [0, 63],
    orTokenIs: [144],
});


// -----------------------------------------------------------------------------
// Chapter 9 - path boundary: startOfPathB = 106, endOfPathB = 146
//   additionalPathB = 148  (extra path-B section outside the main range)
// -----------------------------------------------------------------------------

// GT9.time10() [JADX failure - B1]: path B players -> section 131 (9b_18_1)
patchConditionalTimeTrigger(9, 10, {
    goTo: 131,
    whenTokenInRange: [106, 146],
    orTokenIs: [148],
});


// -----------------------------------------------------------------------------
// Chapter 15 - path boundary: startOfPathB = 106, endOfPathB = 218
//   (No named additionalPathB or additionalPathA constants in Chapter15.java)
// -----------------------------------------------------------------------------

// GT15.time5() [accidental capture - B2 lucky case]: was captured as an
// unconditional trigger (always fires -> 195) because "return 195" happened
// to appear before "return -1" in the decompiled source. It should only fire
// for path B players. Replace the unconditional entry with a conditional one.
patchConditionalTimeTrigger(15, 5, {
    goTo: 195,
    whenTokenInRange: [106, 218],
});

// GT15.time10() [early return -1 - B2]: path A players -> section 33 (15a_8_1)
patchConditionalTimeTrigger(15, 10, {
    goTo: 33,
    whenTokenNotInRange: [106, 218],
});
