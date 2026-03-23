# Patching Guide

This guide explains how to write patches for chapter data that was generated
incorrectly from the decompiled APK. It covers how to investigate a problem,
which patch function to use, and worked examples for every category of issue
that has come up so far.

Patches live in `web/js/patches.js` and call helpers from `web/js/patch_util.js`.
They run at page load, after all `chapter_N.js` files are parsed, and mutate
`CHAPTERS[]` in-place before any user interaction.

---

## The two sources of bugs

**Generated data** comes from `scripts/generate_data.py`, which reads the
decompiled Java source that JADX produced from the APK. Two classes of failure
produce wrong data:

- **JADX decompilation failures:** the decompiler could not reconstruct valid
  Java for a method and emitted either a raw bytecode dump or a stub that
  throws `UnsupportedOperationException`. The generator script finds no
  recognisable return value and either omits the data or falls back to a
  default.

- **Generator regex limitations:** `generate_data.py` uses simple regex
  patterns to extract values from the decompiled text. For path-guarded
  methods (those that return `-1` for the wrong path before returning the
  real value), the regex hits the `-1` guard first and never sees the
  real target.

Patches are the fix for both. They do not modify the generated files - they
overlay corrections on top of `CHAPTERS[]` at runtime.

---

## How to investigate a bug

### 1. Identify the chapter and section

When a navigation problem is reported, the first step is finding the section
in the data. Open the relevant `web/data/chapters/chapter_N.js` and locate
the section by its array index (0-indexed). Each chapter file has a comment
header; sections are listed as array entries.

### 2. Read the decompiled Java

The decompiled source is at:

```
app/src/main/java/com/shadowborne_games/oathsworn/book/
  Chapter1.java ... Chapter22.java   (section/choice data)
  GT1.java    ... GT22.java          (time triggers, onNormalPath)
```

For navigation bugs, look in `ChapterN.java`. For time-trigger bugs, look in
`GTN.java`. See `docs/decompiled-source-reference.md` for the full class
structure.

### 3. Check the storybook

Before writing a patch, verify the correct behaviour against the physical
storybook. The decompiled source is authoritative for structure but has known
failures; the storybook is authoritative for intent. See the "Mapping app
sections to storybook entries" section in `CLAUDE.md` for how to decode asset
names into storybook entry references.

---

## Patch functions at a glance

| Function | What it fixes |
|---|---|
| `patchSection(ch, sec, overrides)` | Any field on a section object |
| `patchTimeTrigger(ch, time, target)` | Add or replace an unconditional time trigger |
| `patchRemoveTimeTrigger(ch, time)` | Delete a time trigger entirely |
| `patchConditionalTimeTrigger(ch, time, condition)` | Add a path-conditional time trigger |
| `patchOnNormalPath(ch, ranges)` | Fix which sections save `nextPositionToken` |
| `patchChapterMeta(ch, field, value)` | Fix a top-level chapter field |

---

## Examples

### Example 1: Wrong choice destination

**Symptom:** Clicking a choice navigates to the wrong section.

**How to spot it:** In `ChapterN.java`, find the section (0-indexed array
entry). Read the `Choice` constructor calls and compare the destination
section numbers to what is in the generated `chapter_N.js`.

**Fix:** Use `patchSection` to overwrite the `choices` array for that section.

```js
// Chapter 3, section 22: the second choice should go to section 31,
// not section 29 as generated.
patchSection(3, 22, {
    choices: [
        { text: 'btn3_14_1__a', next: 14 },   // unchanged
        { text: 'btn3_14_1__b', next: 31 },   // was 29, corrected to 31
    ],
});
```

You only need to include the fields you are changing. `patchSection` does a
shallow `Object.assign` into the existing section object.

If only the `next` value on one choice is wrong and the text is correct, it
is cleaner to reconstruct the full choices array rather than index into it
with dot notation - this makes the intent clear and avoids the generated data
being silently wrong in a way that is hard to spot later.

---

### Example 2: Time trigger completely missing (JADX failure)

**Symptom:** At a certain time-track value, nothing happens - the player is
not redirected when they should be.

**How to spot it:** In `GTN.java`, look at the `timeN()` method for the
affected time value. If it contains `throw new UnsupportedOperationException()`
rather than a `return <int>` statement, the generator omitted the trigger
entirely. The generated `chapter_N.js` will have no entry for that time value
in `timeTriggers`.

**For a chapter without story paths**, use `patchTimeTrigger`:

```js
// Chapter 13, time 11: should redirect all players to section 116.
// GTN13.time11() was an UnsupportedOperationException stub; the generator
// produced no entry. Correct destination found by inspecting the call site
// in the bytecode.
patchTimeTrigger(13, 11, 116);
```

**For a chapter with two story paths**, the redirect destination usually
differs by path. Use `patchConditionalTimeTrigger` instead:

```js
// Chapter 2, time 8: path-B players should go to section 66.
// GT2.time8() was an UnsupportedOperationException stub; no trigger generated.
// Path B is sections 45-85, plus the path-B hub at section 100.
patchConditionalTimeTrigger(2, 8, {
    goTo: 66,
    whenTokenInRange: [45, 85],
    orTokenIs: [100],
});
```

The condition fields are:

| Field | Meaning |
|---|---|
| `whenTokenInRange: [min, max]` | Fire when `nextPositionToken` is between `min` and `max` (inclusive) |
| `whenTokenNotInRange: [min, max]` | Fire when `nextPositionToken` is outside that range |
| `orTokenIs: [v, ...]` | Also fire when `nextPositionToken` equals any of these values |

`orTokenIs` is used alongside `whenTokenInRange` to cover hub or outlier
sections that belong to a path but fall outside the main contiguous section
range.

---

### Example 3: Time trigger captured as wrong value (early return -1)

**Symptom:** At a certain time-track value, all players (or the wrong group
of players) are redirected to the wrong section, or nothing happens even
though the trigger was expected for one path.

**How to spot it:** In `GTN.java`, look at the `timeN()` method. If it has
the path-guard structure below, the generator will have extracted `-1` (the
guard) instead of the real redirect:

```java
int time12() {
    if (nextPositionToken >= 45 && nextPositionToken <= 85) {
        return -1;   // <- "I'm not the right path, skip me"
    }
    // ...
    return 33;       // <- real redirect; generator never reaches this
}
```

The generated `chapter_N.js` will have `timeTriggers[12] = -1`, which means
"never fire". The `-1` is not a valid section index; it is a sentinel.

**Fix:** Replace the bogus entry with a conditional trigger that fires only
for the correct path. The `-1` in `timeTriggers` does not need to be
explicitly deleted first - `patchConditionalTimeTrigger` removes it
automatically.

```js
// Chapter 2, time 12: path-A players should go to section 33.
// GT2.time12() had "return -1" as its first return; the generator recorded -1.
// Path A is sections 0-44, plus the path-A hub at section 99.
patchConditionalTimeTrigger(2, 12, {
    goTo: 33,
    whenTokenInRange: [0, 44],
    orTokenIs: [99],
});
```

If the chapter has no contiguous path-A range, or it is simpler to express
path A as "everything that is not path B", use `whenTokenNotInRange`:

```js
// Chapter 15, time 10: path-A players -> section 33.
// Path A is defined as "not path B" (path B is sections 106-218).
patchConditionalTimeTrigger(15, 10, {
    goTo: 33,
    whenTokenNotInRange: [106, 218],
});
```

---

### Example 4: Unconditional trigger that should be path-conditional

**Symptom:** At a certain time-track value, players on the wrong path are
redirected to a section that belongs to a different story path.

**How to spot it:** In `GTN.java`, look at the `timeN()` method. If it
guards path A with a leading `return -1` but the path-B redirect appears
*before* that guard (the inverted structure), the generator accidentally
captures the real redirect value and emits an unconditional trigger:

```java
int time5() {
    if (nextPositionToken >= 106 && nextPositionToken <= 218) {
        return 195;   // path-B redirect appears first; generator grabs this
    }
    return -1;        // path-A case; generator never reaches this
}
```

The generated `chapter_N.js` has `timeTriggers[5] = 195` - correct value,
wrong scope.

**Fix:** Remove the unconditional trigger and replace it with a conditional
one scoped to the correct path:

```js
// Chapter 15, time 5: was generated as unconditional (195), but should only
// fire for path-B players (token in [106, 218]).
// patchConditionalTimeTrigger removes the unconditional entry automatically.
patchConditionalTimeTrigger(15, 5, {
    goTo: 195,
    whenTokenInRange: [106, 218],
});
```

If you only want to delete a trigger without adding a replacement (for
example, to silence a trigger that should never fire for any player):

```js
patchRemoveTimeTrigger(15, 5);
```

---

### Example 5: Wrong `onNormalPath` ranges (deepwood chapters)

**Symptom:** After returning from a time-triggered journal or event section,
the "return to story" button loops back into the event section instead of
taking the player to their last real story position.

**How to spot it:** In `GTN.java`, look for the `onNormalPath()` method. If
the method body is a raw bytecode dump rather than valid Java, the generator
defaulted to `"always"` for the whole chapter. The correct ranges must be
decoded from the bytecode by hand. See the existing patches in `patches.js`
for the four chapters (4, 10, 14, 17) where this has been done.

The bytecode uses integer-range comparisons (`if-gt`, `if-lt`, `iget-object`
opcodes) to bracket section indices. `0x1` = return true (on normal path),
`0x0` = return false (not on normal path).

**Fix:** Provide the correct ranges as `[firstSection, lastSection]` pairs.
Use `Infinity` as the upper bound for an open-ended final range when the
total section count was not definitively established:

```js
// Chapter 14: normal-path sections are 0-149 and 162+.
// Sections 150-161 are time-triggered event sections that must not save
// nextPositionToken.
patchOnNormalPath(14, [
    [0,   149],
    [162, Infinity],
]);
```

For a chapter with only one excluded block in the middle:

```js
// Chapter 10: normal path is 0-136 and 199-250.
// Sections 137-198 are time-triggered journal/event sections.
patchOnNormalPath(10, [
    [0,   136],
    [199, 250],
]);
```

---

### Example 6: Wrong section content (text, audio, or images)

**Symptom:** The wrong text, audio track, or image appears for a section,
or a section shows content that belongs to a different path.

**Fix:** Overwrite only the affected field using `patchSection`. All array
slots are exactly 4 entries; `null` means unused.

**Wrong text in a slot:**

```js
// Chapter 6, section 40, sectionTexts[1] has the wrong string key.
patchSection(6, 40, {
    sectionTexts: ['chp6_20_1__a', 'chp6_20_1__c', null, null],
});
```

**Missing audio track:**

```js
// Chapter 3, section 15: audio[0] should be 'chp3_8_1__a' but was not generated.
patchSection(3, 15, {
    audio: ['chp3_8_1__a', null, null, null],
});
```

**Wrong image or image position:**

```js
// Chapter 8, section 7: image should be at position 2, not position 4.
patchSection(8, 7, {
    imageLinks:     ['ch8_5_1__p1'],
    imagePositions: [2],
});
```

Image position values 1-8 map to slots in the plate rendering order (see
`docs/chapter_data_structure.md` for the full sort-key table).

---

### Example 7: Wrong `timeAdded` on a section

**Symptom:** The time track advances by the wrong amount when leaving a
section, causing time triggers to fire at the wrong moments or not at all.

**How to spot it:** In `ChapterN.java`, find the `Section` constructor for
that section and check the `timeAdded` argument. Compare it to the value in
the generated `chapter_N.js`.

**Fix:**

```js
// Chapter 5, section 18: timeAdded should be 2, not 1.
patchSection(5, 18, { timeAdded: 2 });

// Chapter 5, section 19: timeAdded should be -1 (no time added).
patchSection(5, 19, { timeAdded: -1 });
```

---

### Example 8: Missing or wrong location

**Symptom:** A location button does not appear, or clicking it navigates to
the wrong section.

**Two separate things can go wrong:**

1. The section that should add the location has the wrong `locationsAdded`
   array.
2. The chapter's `location` map has the wrong destination section for that
   location ID.

**Fix both independently:**

```js
// Chapter 7, section 3 should add location 701 when entered.
patchSection(7, 3, {
    locationsAdded: [701],
});

// Location 701 in chapter 7 should navigate to section 44, not 43.
patchChapterMeta(7, 'location', {
    ...CHAPTERS[7].location,   // preserve existing entries
    '701': 44,
});
```

Note: `patchChapterMeta` replaces the field entirely, so spread the existing
`location` object if you only want to change one entry.

---

### Example 9: Clue mechanic wrong

**Symptom:** The hidden clue location is unlocked too early, too late, or
not at all; or it navigates to the wrong section.

The clue mechanic requires the player to visit both sections listed in
`clue[]`. When both are visited, `clueLocation` is added to the active
locations list, and clicking it navigates to `clueLocationSectionNum`.

**Fix:**

```js
// Chapter 11: clue sections should be 25 and 30 (not 25 and 28 as generated).
// The unlocked location is ID 1101, which navigates to section 55.
patchChapterMeta(11, 'clue', [25, 30]);
patchChapterMeta(11, 'clueLocation', 1101);
patchChapterMeta(11, 'clueLocationSectionNum', 55);
```

---

## Adding a comment to your patch

Every patch in `patches.js` should have a comment that explains:

1. **Where the data came from** - which Java method, and what the decompiler
   produced (e.g. UnsupportedOperationException stub, early `return -1`).
2. **What the correct value is** - and where you found it (bytecode call site,
   storybook verification, etc.).
3. **Why the condition is scoped the way it is** - for conditional time
   triggers, explain what the path boundaries are and where any `orTokenIs`
   values come from.

A short human-readable summary after the technical note is also helpful for
anyone who needs to understand the bug without reading bytecode.

See the existing patches in `patches.js` for the established comment style.

---

## Testing a patch

There is no automated test suite. To verify a patch:

1. Open `web/index.html` in a browser (after running `./setup.sh` at least
   once to generate the data files).
2. Navigate to the affected chapter and section.
3. Confirm the behaviour matches the physical storybook.

For time trigger patches, use the in-game time track to advance to the
relevant time value and confirm the redirect fires for the correct path only.
The browser console will show any `patchXxx: chapter N not found` warnings if
a patch references a chapter or section that does not exist.
