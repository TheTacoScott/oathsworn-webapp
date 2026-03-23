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
//
// TECHNICAL: GT4.java's onNormalPath() method decompiled to a raw Dalvik bytecode
// dump rather than valid Java source. The Dalvik VM represents boolean return
// values as integers: 0x1 = true, 0x0 = false. In the bytecode, the method
// contains a series of int-range comparisons (iget-object / if-gt / if-lt
// opcodes) that bracket section indices. JADX was unable to lift these to
// structured Java because the method used a non-standard register layout that
// confused the CFG reconstruction pass. The generator script (generate_data.py)
// uses a simple regex, r'"return true"', on the decompiled text. Since neither
// "return true" nor "return false" appears anywhere in the bytecode dump, the
// script's fallback branch fires and emits onNormalPath: "always" for every
// section. That is wrong: sections 58-89 are time-triggered journal entries
// that MUST NOT update nextPositionToken.
//
// The three non-contiguous ranges below were recovered by reading the raw
// bytecode switch table and iget-object comparisons in GT4.java by hand:
//   0-57:    main narrative arc (all update nextPositionToken)
//   58-89:   Deepwood journal entries injected by the time track (must NOT
//             update nextPositionToken, so "return to story" lands back at the
//             narrative, not inside a journal popup)
//   90-124:  Second-visit Deepwood sections (DO update nextPositionToken because
//             the player navigates them directly, not via a time trigger)
//
// HUMAN READABLE: Chapter 4 is a "Deepwood" chapter that has a separate batch
// of journal-entry sections (58-89) that pop up automatically when the in-game
// time track fires. Those aren't real story positions - they're more like
// cutscene interruptions. If the game saved your position as being "inside the
// journal popup", pressing "return to story" would just loop you back into the
// popup forever. By telling the engine that only sections 0-57 and 90-124 are
// real story positions, we ensure that "return to story" always takes you back
// to actual narrative content.
patchOnNormalPath(4, [
    [0,  57],
    [90, 124],
]);

// --- Chapter 10 ---
//
// TECHNICAL: Same JADX decompilation failure as Chapter 4 (GT10.java). The
// onNormalPath() method uses a multi-arm conditional that the CFG pass could
// not reconstruct. The bytecode was inspected manually: two int-range checks
// bracket sections 0-136 (first narrative block) and 199-250 (second narrative
// block). Sections 137-198 are a dense cluster of time-triggered journal and
// event sections. Because they are interleaved with normal narrative sections
// in the .smali opcodes, JADX cannot trivially hoist them; the decompiler gives
// up and dumps raw bytecode instead. The generator's regex finds no "return
// true" / "return false" and defaults to "always", incorrectly marking the
// 137-198 journal cluster as saving nextPositionToken.
//
// HUMAN READABLE: Chapter 10 is a longer chapter with two distinct narrative
// blocks separated by a big chunk of time-triggered journal/event sections
// (sections 137-198). The game should never save your story position as being
// "inside" one of those automatic event sections. This patch corrects that so
// the game only treats sections 0-136 and 199-250 as real story positions.
patchOnNormalPath(10, [
    [0,   136],
    [199, 250],
]);

// --- Chapter 14 ---
//
// TECHNICAL: GT14.java suffered the same JADX decompilation failure. Manual
// bytecode inspection shows one contiguous block of normal-path sections (0-149),
// then a gap of time-triggered sections (150-161), then an open-ended block
// starting at 162 that runs to the end of the chapter. The gap is small (only
// 12 sections) but critical: if any of 150-161 were to save nextPositionToken,
// "return to story" choices would route players into the middle of those event
// sequences. The upper bound is left as Infinity because the total section count
// for this chapter was not definitively established from the bytecode alone, and
// any future section additions should still be treated as normal path.
//
// HUMAN READABLE: Chapter 14 has a short run of automated event sections
// (150-161) sandwiched between two narrative blocks. This patch makes the engine
// ignore those 12 event sections when saving your story position, so "return to
// story" reliably takes you back to real narrative content rather than dropping
// you mid-event.
patchOnNormalPath(14, [
    [0,   149],
    [162, Infinity],
]);

// --- Chapter 17 ---
//
// TECHNICAL: GT17.java, same failure mode. The bytecode shows a standard
// normal-path range of 0-100, a time-triggered journal block of 101-138, then
// an open-ended normal-path range beginning at 139. The journal block is unusually
// large (38 sections) compared to chapters 4 and 14, which likely contributed to
// JADX's CFG confusion: the many branches from the journal dispatch table produce
// a large number of predecessor blocks for the merge point at section 139, and
// the decompiler's phi-elimination pass gave up. Upper bound is Infinity for the
// same reason as Chapter 14.
//
// HUMAN READABLE: Chapter 17 has a large block of 38 automated journal sections
// (101-138) that fire via the time track. Without this patch the game would
// incorrectly save your story position as being inside one of those journal
// entries. The fix makes the engine treat only sections 0-100 and 139+ as real
// story positions.
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
//
// TECHNICAL: GT2.time8() decompiled by JADX as a method body containing only
// "throw new UnsupportedOperationException();". This is an artefact of the DEX
// compiler's treatment of abstract-like dispatch: the actual implementation was
// inlined into the caller in the optimised bytecode, and JADX's method-boundary
// detection placed the stub here instead of the real code. Because the method
// body contains no "return N;" statement, generate_data.py's regex
// r'return\s+(-?\d+)\s*;' matches nothing, and the time8 entry is entirely
// absent from the generated timeTriggers object. The correct redirect (section 66,
// named "2b_30_1" in the source asset IDs) was found by searching the caller
// site in the bytecode. This trigger should only fire for path-B players
// (nextPositionToken in [45, 85] or equal to the path-B hub at 100).
//
// HUMAN READABLE: At time-track position 8 in chapter 2, path-B players are
// supposed to be redirected to section 66 (a path-B story beat). The generator
// completely missed this trigger because the decompiler produced broken code for
// the underlying Java method. This patch puts the missing trigger back in, but
// only for players who are actually on path B.
patchConditionalTimeTrigger(2, 8, {
    goTo: 66,
    whenTokenInRange: [45, 85],
    orTokenIs: [100],
});

// GT2.time12() [early return -1 - B2]: path A players -> section 33 (2a_40_1)
//
// TECHNICAL: GT2.time12() has the classic path-guard structure:
//
//   int time12() {
//       if (nextPositionToken >= 45 && nextPositionToken <= 85) {
//           return -1;   // <- this is the "I'm not on path A, skip me" guard
//       }
//       ...
//       return 33;       // <- actual redirect for path-A players
//   }
//
// generate_data.py extracts time triggers with a regex that takes the first
// "return <number>;" match in the method body. The guard "return -1;" appears
// first, so the script records timeTriggers[12] = -1, meaning "this trigger
// never fires". The real redirect (33) is never extracted. The fix replaces
// that bogus -1 entry with a conditional trigger: only fire when the player's
// nextPositionToken places them on path A (token in [0, 44] or equal to the
// path-A hub at 99). The additional orTokenIs: [99] covers the case where the
// player is sitting at the location-select hub section for path A, which sits
// outside the main 0-44 narrative range.
//
// HUMAN READABLE: At time-track position 12 in chapter 2, path-A players
// should be sent to section 33 (a path-A story beat). The generator extracted
// -1 instead of 33 because it grabbed the first return value it found, which
// happened to be the path-B exclusion guard (-1 means "don't fire"). This patch
// replaces that non-trigger with the correct redirect, locked to path-A players
// only.
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
//
// TECHNICAL: Same UnsupportedOperationException stub as GT2.time8() above.
// JADX emitted the method as throwing rather than returning, so the generator's
// regex finds no return value and omits the trigger. Bytecode inspection of the
// call site reveals the intended redirect: section 93 ("5b_30_1"), which is a
// path-B time-triggered story event. Three additional path-B sections (101, 102,
// 104) exist outside the main [49, 96] block; they are hub/junction sections
// that the player can reach while on path B but that don't fall in the contiguous
// range. These are included via orTokenIs so the trigger still fires when the
// player's saved token is one of those outlier sections.
//
// HUMAN READABLE: At time-track position 10 in chapter 5, path-B players
// should jump to section 93. The generator dropped this trigger entirely because
// the decompiler produced broken code for the underlying Java method. This patch
// restores the missing trigger, targeting only path-B players (including three
// edge-case path-B hub sections that sit outside the main section range).
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
//
// TECHNICAL: GT7.time9() is another UnsupportedOperationException stub (same
// JADX failure mode as GT2.time8 and GT5.time10). The method's effective body
// was inlined at the call site in the optimised DEX and only the stub remained
// at the declared method address. The generator finds no return statement and
// omits the trigger. Bytecode call-site inspection yields the redirect: section
// 71 ("7b_12_20"), a path-B event. Section 145 is an additional path-B outlier
// hub that sits above the contiguous [64, 143] range.
//
// HUMAN READABLE: At time-track position 9 in chapter 7, path-B players should
// be sent to section 71. The generator completely missed this because the
// decompiler couldn't produce working Java for the method. This patch restores
// the trigger for path-B players only, including the outlier path-B hub at 145.
patchConditionalTimeTrigger(7, 9, {
    goTo: 71,
    whenTokenInRange: [64, 143],
    orTokenIs: [145],
});

// GT7.time14() [early return -1 - B2]: path A players -> section 63 (7a_30_3)
//
// TECHNICAL: GT7.time14() has the same path-guard structure as GT2.time12():
//
//   int time14() {
//       if (nextPositionToken >= 64 && nextPositionToken <= 143) {
//           return -1;   // <- path-B guard; generator grabs this
//       }
//       ...
//       return 63;       // <- real redirect for path A; never seen by regex
//   }
//
// The generator records timeTriggers[14] = -1 (no-fire). The real target is
// section 63 ("7a_30_3"), a path-A narrative beat. Section 144 is the path-A
// outlier hub outside [0, 63], included via orTokenIs for the same reason as
// the path-B counterparts above.
//
// HUMAN READABLE: At time-track position 14 in chapter 7, path-A players
// should jump to section 63. The generator grabbed -1 (the path-B exclusion
// guard) instead of 63 because -1 appeared first in the source. This patch
// replaces the bogus no-fire entry with the correct path-A-only redirect.
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
//
// TECHNICAL: GT9.time10() is a fourth UnsupportedOperationException stub
// (same failure mode as GT2/GT5/GT7). JADX placed the stub at this method's
// declared address while the real implementation was inlined elsewhere in the
// optimised DEX. The generator finds no return value and omits the trigger.
// Bytecode call-site inspection identifies section 131 ("9b_18_1") as the
// intended redirect. Section 148 is a single path-B outlier hub above the
// contiguous [106, 146] block.
//
// HUMAN READABLE: At time-track position 10 in chapter 9, path-B players are
// supposed to jump to section 131. The trigger was completely missing from the
// generated data because the decompiler produced broken code. This patch
// restores it for path-B players only, including the single outlier path-B
// section at 148.
patchConditionalTimeTrigger(9, 10, {
    goTo: 131,
    whenTokenInRange: [106, 146],
    orTokenIs: [148],
});


// -----------------------------------------------------------------------------
// Chapter 15 - path boundary: startOfPathB = 106, endOfPathB = 218
//   (No named additionalPathB or additionalPathA constants in Chapter15.java)
// -----------------------------------------------------------------------------

// GT15.time5() [accidental capture - B2 lucky case]: was captured as unconditional
// trigger -> 195; should be path B only.
//
// TECHNICAL: GT15.time5() has the inverted guard structure compared to the
// other B2 cases. In the decompiled Java the path-B redirect (195) appears
// BEFORE the path-A guard ("return -1;"):
//
//   int time5() {
//       if (nextPositionToken >= 106 && nextPositionToken <= 218) {
//           return 195;   // <- path-B redirect; generator grabs this (lucky!)
//       }
//       return -1;        // <- path-A guard; never seen by regex
//   }
//
// Because the generator's regex hits 195 first, it records timeTriggers[5] = 195
// as an UNCONDITIONAL trigger, meaning it would fire for ALL players regardless
// of path. That is wrong: path-A players hitting this time mark should not be
// redirected anywhere (return -1). The fix replaces the unconditional entry with
// a conditional trigger scoped to path-B only (token in [106, 218]).
//
// HUMAN READABLE: At time-track position 5 in chapter 15, only path-B players
// should jump to section 195. The generator accidentally captured this as firing
// for everyone (because 195 happened to appear before the guard clause in the
// source, which is the reverse of the usual order). Without this patch, path-A
// players would be incorrectly yanked to a path-B section when the time track
// reaches position 5.
patchConditionalTimeTrigger(15, 5, {
    goTo: 195,
    whenTokenInRange: [106, 218],
});

// GT15.time10() [early return -1 - B2]: path A players -> section 33 (15a_8_1)
//
// TECHNICAL: GT15.time10() has the standard path-guard structure (same as
// GT2.time12 and GT7.time14):
//
//   int time10() {
//       if (nextPositionToken >= 106 && nextPositionToken <= 218) {
//           return -1;   // <- path-B guard; generator grabs this
//       }
//       ...
//       return 33;       // <- real redirect for path-A players; never extracted
//   }
//
// The generator records timeTriggers[10] = -1 (no-fire). The real target is
// section 33 ("15a_8_1"), a path-A narrative beat. Unlike the other B2 patches,
// path A here is defined as "anything that is NOT path B", so the condition uses
// whenTokenNotInRange instead of a positive range + orTokenIs. There are no
// known additional path-A outlier sections outside [0, 105] for chapter 15.
//
// HUMAN READABLE: At time-track position 10 in chapter 15, path-A players
// should be redirected to section 33. The generator grabbed -1 (the path-B
// exclusion guard) because it was the first return value in the method, so the
// real redirect was never recorded. This patch restores it using a "not path B"
// condition, which is cleaner than enumerating all path-A section numbers
// individually.
patchConditionalTimeTrigger(15, 10, {
    goTo: 33,
    whenTokenNotInRange: [106, 218],
});
