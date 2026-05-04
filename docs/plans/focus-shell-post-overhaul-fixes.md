# Plan — Focus-shell post-overhaul fixes and features (v2)

> **Status: drafted 2026-05-03; pre-implementation.** Six items grouped into one round, slated for the next implementation pass after the focus-shell overhaul (commits `3734b5c..415d969`) lands. Hashes will land here once the work commits.

The focus-shell overhaul shipped a structurally-correct shell — three bars in the chrome row, audio cues at the per-question target, session-timer auto-redirect, typography aligned to the target screenshots. Dogfooding then surfaced one regression and five tuning items. The regression (a triage-take dead-end) blocks Phase 3 dogfooding entirely; the rest are tuning that the user noticed once the structural work was out of the way. They land together because they share the same component surface and the same playwright-core verification protocol — verifying them together amortizes the harness setup cost.

## What changed from v1

The v1 plan modeled audio as three distinct synthesized layers — a louder pre-dong tick, a real-gong dong sample, and a harsher post-dong tick — with peak-gain tuning across all three. v2 collapses the entire audio model to a single rule:

**One MP3 picked at random from `./data/sounds` at session start, looped continuously starting when `elapsedQuestionMs` first crosses `perQuestionTargetMs`, stopped on `advance`. Same file replays for every question in the same session.**

This eliminates pre-dong ticks entirely, eliminates the dong's distinctness from post-dong audio, eliminates synth-vs-sample fallback logic, and eliminates per-second cross-detection in `focus-shell.tsx`. The implementation surface for the audio work shrinks by roughly 60%.

The rest of the plan is unchanged. If you reviewed v1, the changed sections are §3, §5, §8 (commit sequencing), and §11 (open questions). Items 1, 5, and 6 are word-for-word identical.

## 1. Why these six items, why now

The six items cluster into three themes:

- **Triage post-flow integrity (item 1).** A regression: after the user takes the triage prompt, the new item paints but doesn't accept input. This is a load-bearing bug — without a working triage take, the pedagogical core of the focus shell (the "abandon and advance" decision) can't be exercised. Highest priority; blocks dogfooding.
- **Audio escalation discipline (items 2-4, now collapsed into a single "looping urgency sample" model).** The synthesized dong is too gentle; silence past the target lets users linger without escalation. v2's single rule replaces the v1 three-layer model.
- **Richer timing visualization (items 5, 6).** Two visual upgrades that the existing one-bar / one-color shell can't express: a second per-question bar to show overtime budget without changing the "no auto-submit" rule, and a pace-deficit color flip on the question progression bar so users can see at a glance whether they're behind on the session as a whole.

The bug fix MUST land first, in its own commit, so subsequent feature commits can verify against a working triage flow. After the bug fix, the audio commit and then the visual commits — audio is cheaper to verify than the dual-bar visual, and the visual commit is the riskiest item in the round.

## 2. Item 1 — Triage take strands the user on the next item (BUG)

### What's broken

After the user takes the triage prompt — by clicking the prompt button or pressing Space — the network round-trip completes, the next item's text and options paint into the DOM, but the user can't interact with the rendered next item. Reproduction is reported as 100% on Phase 3 dogfood drills. SPEC §6.7 specifies that `triage_take` "submits whatever the user has selected, blank if nothing" and that `triageTaken = true` only if taken within 3000ms of `triagePromptFiredAtMs`; the spec's flow assumes seamless advance.

The bug surfaces on the triage path but not on the regular Submit-button path, even though both flows route through `submitPending: true` and the same `runSubmitWhenPending` effect, because the entry conditions differ:

- The Submit-button entry has `triagePromptFired: false` for the entire flow (Submit before the per-question target) OR `triagePromptFired: true` (Submit after the per-question target). In the latter case, the triage prompt overlay is mounted during the network await and kept visible until `advance` resets `triagePromptFired: false`. Same as the triage-take path on that axis.
- The triage-take entry adds: the user's click landed on the `<TriagePrompt>` button (sets `document.activeElement`), and `<InterQuestionCard>` opacities up over the entire viewport during the await. After advance, both overlays unmount.

### Candidate root causes (must be diagnosed empirically before fix)

Read in priority order:

1. **`submitPending` doesn't clear cleanly on advance.** Today the flag is cleared only by `set_question_started` from the new `<ItemSlot>`'s mount effect (`shell-reducer.ts` line ~256, comment block at line ~54). The reducer comment explicitly chooses this path to close a double-Enter race during the await window. If React 19's reconciliation defers the keyed `<ItemSlot>` remount across a transition (Cache Components are enabled in this project — see `next.config.*`), the mount effect doesn't fire promptly, `submitPending` stays true, and the Submit button stays disabled. **Option clicks would still work, but Submit clicks register as no-ops.** The user perceives this as "the page doesn't respond."
2. **`<InterQuestionCard>` blocks pointer events past its visibility window.** The card is `fixed inset-0 bg-background/60 backdrop-blur-sm` with no `pointer-events-none`. While `props.visible === true` is the canonical gate, if the React commit phase orders advance's commit before the card's render-tree update (a single-frame race in dev), pointer events on the new item could be intercepted for one frame.
3. **Stale `stateRef.current` in the Space-key handler.** `stateRef` is synced via a `useEffect` on `[state]`; effects run after commit. Between the `advance` commit and the `syncStateRef` effect, a Space keypress reads stale `triagePromptFired: true` and stale `submitPending: true`. The handler short-circuits on submitPending so no double-take fires, but `event.preventDefault()` runs before the short-circuit — a Space keypress in this window is silently swallowed.
4. **`<ItemSlot>` mount effect doesn't fire because the key didn't actually change.** If the server returns the same `nextItem.id` as the current `currentItem.id` (a server-side bug that surfaces here as a UI dead-end), React doesn't unmount/remount, the empty-deps mount effect doesn't fire, `submitPending` never clears. Long shot, but worth a sanity check — the server's `submitAttempt` flow could in principle return the same item under some failure mode.

### What it should do

After the user takes the triage prompt:

- The next item paints (current behavior — works).
- All overlays clear within one render frame (current behavior — works on the surface).
- The Submit button becomes enabled (broken).
- Option buttons accept clicks and the click dispatches `select` (probably works; symptom is broader than just Submit).
- The Space key on the new item is a no-op (because `triagePromptFired: false`) (current behavior — works).

The fix should be the **smallest change that makes the triage-take flow indistinguishable from the regular-submit flow** at the user-interaction level past advance.

### Implementation seam

Recommended fix path, contingent on diagnosis:

- **If candidate #1 is the cause** (most likely): clear `submitPending: false` inside `reduceAdvance` directly, in addition to the existing clear in `set_question_started`. The reducer comment (lines 53–60) currently argues the clear should happen at `set_question_started` to close the double-Enter race during the await. That race only exists when `submitPending` is true AND the await is in flight — neither condition holds after `advance` (the await completed and dispatched advance), so clearing in advance is safe. Keep the `set_question_started` clear in place as belt-and-suspenders for any future flow that doesn't go through advance.
- **If candidate #2 is also a contributor**: add `pointer-events-none` to `<InterQuestionCard>`'s outermost div. The card is purely decorative (the comment at `inter-question-card.tsx:8` says "Just a soft visual transition"); blocking pointer events serves no design intent.
- **If candidate #3 is observed**: add a `useLayoutEffect` (instead of `useEffect`) for `syncStateRef`. Layout effects fire synchronously after commit, eliminating the stale-state window for the Space-key handler. Safe because `stateRef` is only read by event handlers, never during render.
- **If candidate #4 is observed**: the bug is server-side, not in the focus shell. Out of scope for this commit; surface as a separate finding to investigate the server's `submitAttempt`.

The plan's expected fix is candidates #1 + #2 together (one-line reducer change + one-className change). Candidate #3 likely doesn't actually surface (the Space-press window is microseconds) but is cheap to mitigate proactively.

### Reducer / state changes

Specific additions to `reduceAdvance` in `src/components/focus-shell/shell-reducer.ts`:

```
// in reduceAdvance, alongside existing resets:
submitPending: false,           // NEW — fix candidate #1
```

The `set_question_started` handler retains its existing `submitPending: false` clear; the two clears are now redundant but the redundancy is the point (defense-in-depth across the two paths into "next item is interactable").

No new `ShellState` fields. No new action variants.

### Verification scenarios

Single regression test, run against a real drill (since the smoke route's `onEndSession` is a stub but `onSubmitAttempt` cycles items):

1. Start a 5-question drill, sign in via the harness's auth-cookie injection (per the established protocol).
2. Wait for the per-question timer to cross 18s (or fast-forward via `?per-question` smoke flag if added; otherwise 18s wall).
3. Click the triage prompt (or press Space).
4. Wait for the new item to render (poll for `data-testid="question-progression-bar" data-filled` to advance — the second segment should be filled).
5. Click an option button on the new item. Assert the button's `aria-pressed` flips to `true`.
6. Click Submit. Assert the Submit button responds (the next item paints, or the session ends — either way, advance progresses).
7. Repeat for the Space-key entry path (press Space during a question target overrun) and confirm the same outcome.

Negative control: run the same scenario on the current `main` branch BEFORE the fix and confirm the click on the option button does NOT register (`aria-pressed` stays false). This confirms the harness reproduces the bug.

## 3. Items 2-4 — Replace audio model with one looped sample per session (FEATURE)

### What's missing

Today's audio model (post-commit 6) fires a soft 880 Hz pre-dong tick at integer seconds 10-17, a synthesized 220 Hz dong at second 18, then silence. Three problems surfaced in dogfooding:

- The dong is too gentle — users hear it and keep working.
- The pre-dong tick is too quiet at default OS volume.
- Silence past the target lets users linger indefinitely without escalation.

v1 of this plan modeled the fix as three distinct audio paths (gong sample for the dong, harsher square-wave post-dong tick, gain bumps for both pre- and post-dong). v2 collapses all three into a single rule.

### What it should do

**One audio rule replaces the entire pre-dong tick + dong + post-dong tick model:**

- At session start, pick one MP3 file at random from a curated bank under `data/sounds/`. Hold the chosen file for the entire session. Every question in the session uses the same file.
- When `elapsedQuestionMs` first crosses `perQuestionTargetMs`, start playback of the chosen file with `loop = true`.
- When the user advances to the next item (any path: Submit click, Space, triage take), stop playback. The next question's audio uses the same file but starts fresh from `currentTime = 0` if and when it crosses its own per-question target.
- No volume bumps, no synth, no per-second cross detection, no dedup logic. The browser handles the loop; the `advance` action handles the stop.

The pedagogical contract stays the same: silence in the first window of the question (0 to per-question target), continuous escalating audio after the target until the user advances. The escalation is now "the same loop keeps playing" rather than "tick → dong → harsher tick."

### Bank of sounds

Curated MP3 files live at `data/sounds/`. The directory is the source of truth — adding a new file extends the random pool without code changes.

The plan does NOT specify which sounds belong in the bank. Leo curates the files; the implementer just enumerates the directory at runtime. Suggested initial bank: 3-5 short loopable samples (5-15 seconds each) ranging from "moderately annoying" (e.g., a clock-tick at uncomfortable speed) to "actively unpleasant" (e.g., a warning klaxon). The randomization gives the user variety across sessions; the curation gives Leo control over the upper bound of unpleasantness.

File requirements:
- MP3 format (`*.mp3`). Browsers all decode it; OGG would also work but MP3 is the most universal choice.
- Designed to loop cleanly (no abrupt start or end click). The implementer doesn't need to verify this — Leo curates.
- Reasonably small. ~50-300 KB per file at moderate bitrate is fine; the browser caches after first decode so repeat playback within a session is free.
- No license-restricted samples. Each file in `data/sounds/` should have a CC0 / public-domain or owned-content provenance documented in `data/sounds/LICENSE.md`.

### Implementation seam

Three files touched.

**`scripts/copy-sounds-to-public.ts`** (NEW, or alternatively a build-time step in an existing script): copies `data/sounds/*.mp3` → `public/audio/sounds/*.mp3` so the browser can fetch them. Two reasons not to put the source files directly in `public/`:

- `data/` is the project's convention for human-curated assets (matches `data/testbank/` for OCR sources).
- Copying lets a future `data/sounds/` rename or restructure not break the public URL.

If the project already has an asset-copy mechanism, hook into it. Otherwise a simple copy-on-`bun dev` and copy-on-`bun build` script works. The script is exempt from the Superbuilder ruleset (Bun script).

**`src/components/focus-shell/audio-ticker.ts`** (REWRITTEN, not extended): collapse the existing pre-dong tick + dong synth code. New exports:

- `unlockAudio()` — same as today; creates the AudioContext on first user interaction. Also fetches and decodes the chosen sound file's `AudioBuffer` (see below).
- `pickSessionSound(): string` — runs once per session at unlock time. Reads a manifest of available sounds (either fetched from a `/api/audio/sounds-manifest` route, or hardcoded in a `src/config/sound-bank.ts` file generated at build time from `data/sounds/`). Picks one path uniformly at random. Returns the `/audio/sounds/<filename>.mp3` URL.
- `startUrgencyLoop()` — creates an `AudioBufferSourceNode` from the cached buffer with `loop = true`, connects through a `GainNode` (peak gain ~0.7-0.85, set once per session, no envelope), starts at `currentTime`. Stores the source node in a module-level ref so `stopUrgencyLoop` can stop it.
- `stopUrgencyLoop()` — calls `.stop()` on the active source node, clears the ref. Safe to call when no loop is active (no-op).

Drop the old `playTick`, `playDong`, and any pre-dong-tick / cross-second-detection logic. CustomEvent dispatch survives but with a simplified shape: `kind: "urgency-loop-start"` and `kind: "urgency-loop-stop"` events at the corresponding lifecycle points, for harness instrumentation.

The session-sound-pick logic happens once per AudioContext creation. The same file URL lives in module state for the lifetime of the page; a hard refresh starts a new session and re-picks.

**`src/components/focus-shell/focus-shell.tsx`** (SIMPLIFIED): the existing `maybePlayAudio` effect (around line 246) shrinks dramatically. Replace the cross-second detection loop with two effects:

- **Start effect**: fires when `elapsedQuestionMs >= perQuestionTargetMs` AND `urgencyLoopStartedForCurrentQuestion: false`. Calls `startUrgencyLoop()` then sets the flag (via a new reducer action — see below).
- **Stop effect**: fires on `advance` (specifically, on `currentItem.id` change in a `useEffect`). Calls `stopUrgencyLoop()` then resets the flag.

`unlockAudio()` continues to be wired into the existing user-interaction handlers (option select, Submit, Space-triage). It's unchanged in trigger; only the work it does on first call expands (now also decodes the chosen sound).

### Reducer / state changes

One new field in `ShellState`:

```
urgencyLoopStartedForCurrentQuestion: boolean
```

Initial value: `false`. Reset to `false` in `reduceAdvance` (the existing audio-flag-reset pattern). One new action variant:

```
| { kind: "urgency_loop_started" }
```

Reducer handler: sets `urgencyLoopStartedForCurrentQuestion: true`. Idempotent — second dispatch is a no-op.

The existing `dongPlayedForCurrentQuestion` field becomes unused after this commit. Remove it from `ShellState`, drop the `dong_played` action variant. The cleanup is part of the same commit.

### Verification scenarios

Run all scenarios on the smoke route with `?qt=true` (per-question timer enabled, the precondition for audio).

1. **Loop starts at target.** Wait for `elapsedQuestionMs` to cross `perQuestionTargetMs` (18s wall, or fast-forwarded via existing test affordances). Assert exactly one `urgency-loop-start` CustomEvent fires within 100ms of the crossing. Assert the AudioBufferSourceNode created has `loop === true`. Assert the playing buffer's `byteLength` matches the session-picked file's expected size (verifies the right file was loaded, not a fallback).

2. **Loop stops on advance.** With the loop running, click an option and Submit. Assert exactly one `urgency-loop-stop` CustomEvent fires within 100ms of the click. Assert the source node's `playbackState` is `FINISHED_STATE` (or equivalent — the Web Audio API doesn't expose state directly; verify via `onended` callback firing).

3. **Same file across questions.** Complete question 1 by going past target then advancing. On question 2, again wait past target. Assert the URL fetched (or the AudioBuffer reference) is identical between the two `urgency-loop-start` events. The session pick is held; question 2 doesn't re-randomize.

4. **Different file across sessions.** Hard-refresh the page (new AudioContext, new session pick). Wait past target on question 1. Capture the URL. Repeat 5 times across 5 sessions. Assert at least 2 distinct URLs were chosen (with 3+ files in the bank, this is statistically near-certain; if all 5 sessions pick the same file, the random pick is broken).

5. **Quiet when timer hidden.** Navigate to `?qt=false`. Cross the per-question target. Assert zero `urgency-loop-start` events. The loop is gated on `timerPrefs.questionTimerVisible` the same way the old dong was.

6. **Quiet before first interaction.** Drive the timer past target without clicking anything (no `unlockAudio` invoked). Assert zero loop-start events. AudioContext autoplay policy is honored — silent failure is the correct behavior.

7. **Triage take stops the loop.** Cross the target so the loop is running. Take the triage prompt (Space or click). Assert one `urgency-loop-stop` event fires (advance triggered by the take). This regression-protects against the loop continuing past triage take, which would be a worse UX than the current silence.

8. **Loop resumes on next question's target crossing, not before.** After question 1 advances, on question 2 wait until t=10s (well before the 18s target). Assert no loop-start event has fired yet. Wait until t=19s. Assert loop-start fires once.

## 4. (Removed in v2)

Item 3 of v1 (post-dong tick distinctness) and item 4 of v1 (volume bumps across the board) are absorbed into §3. The audio model is now one rule, not three. The numbered items in this plan track the user's original prompt's enumeration; in v2, items 2-4 share §3 as a single audio commit.

## 5. (Removed in v2)

See §4. v1 had this as item 4 (volume bumps); v2 absorbs into §3.

## 6. Item 5 — Two stacked per-question timer bars with phase-keyed colors (FEATURE — significant)

### What's missing

The current `<QuestionTimerBar>` (post-commit 5) shows ONE bar that fills red 0→100% over `perQuestionTargetMs` and stays at 100% past the target. It can't express the user's first-window-vs-overflow distinction, and its "always red" framing doesn't reward the user for being early in the question (where blue-as-time-remaining would).

### What it should do

Two stacked bars in the chrome row, replacing the single `<QuestionTimerBar>`:

**Top (primary) bar**: covers `[0, perQuestionTargetMs)`.

- Fill ratio: `min(elapsedQuestionMs / perQuestionTargetMs, 1.0)`.
- Color: BLUE for `elapsedQuestionMs < perQuestionTargetMs / 2`; RED for `elapsedQuestionMs >= perQuestionTargetMs / 2`. **The entire current fill turns red at the half-target boundary — discrete flip, not a gradient.** Not a position-on-bar split; a time-elapsed split that retroactively repaints the whole filled region.
- After `elapsedQuestionMs >= perQuestionTargetMs`, the bar caps at 100% red (same as today's single bar).

**Bottom (overflow) bar**: covers `[perQuestionTargetMs, 2 * perQuestionTargetMs)`.

- Fill ratio: `clamp((elapsedQuestionMs - perQuestionTargetMs) / perQuestionTargetMs, 0, 1)`.
- Empty for `elapsedQuestionMs < perQuestionTargetMs`.
- Fills 0→100% red for `elapsedQuestionMs in [perQuestionTargetMs, 2 * perQuestionTargetMs)`.
- Caps at 100% red beyond `2 * perQuestionTargetMs`. No third bar; the visual maxes out at "two full red bars."

Same length, height, gray track, label position as today's single bar. The label "Per question time" continues to sit beneath the bottom bar (single label for the stack, not per-bar).

### Implementation seam — bar topology

Recommend: split into two siblings inside a new wrapper.

- New `<QuestionTimerBarStack>` parent at `src/components/focus-shell/question-timer-bar-stack.tsx`. Owns the gray track shape, the label, and the layout rhythm.
- Renamed-into-stack `<QuestionTimerBarPrimary>` (the existing `<QuestionTimerBar>` component, refactored to take a phase-keyed fill — see below).
- New `<QuestionTimerBarOverflow>` sibling, structurally similar to primary but uses `animation-delay:18000ms` to start filling after the primary completes.
- `<FocusShell>` swaps its `<QuestionTimerBar>` import for `<QuestionTimerBarStack>`. Same prop signature (`itemId`, `perQuestionTargetMs`).

This matches the bar-per-component pattern from the existing chrome row (`<QuestionProgressionBar>`, `<SessionTimerBar>`) and keeps each component's responsibility narrow. The wrapper owns layout; each bar component owns its own fill.

The existing `<QuestionTimerBar>` file gets renamed-and-refactored rather than deleted-and-replaced — preserves git blame for the commit-5 work.

### Implementation seam — primary bar phase-keyed fill

The CSS-keyframe `transform: scaleX` approach from commits 4-5 doesn't natively support a discrete color flip mid-animation. Three options were considered:

1. **Two stacked fill elements (blue underneath, red on top) with the red one's transform delayed by `perQuestionTargetMs/2`.** Cheap and matches the existing pattern.
2. **A single fill with a CSS `background: linear-gradient(...)` whose stop position is animated.** Complex; gradients animate at the GPU layer but sub-stop animation is fragile cross-browser.
3. **Drop the keyframe approach entirely; drive width from React state via inline style or CSS variable on every RAF tick.** Most flexible but conflicts with `rules/no-inline-style.md` and adds React work per frame.

The user's prompt recommended option 1 ("two stacked fills with delayed-start red overlay, cheapest, matches existing pattern"). On closer inspection, **option 1 as described doesn't satisfy the spec** — at t = 13.5s with target = 18s, blue's scaleX is 0.75 (75% width) and red's scaleX is 0.5 (50% width with delay+duration of 9s); red would overlay blue 0-50%, leaving blue 50-75% visible. The result is a MIXED bar (red 0-50%, blue 50-75%, gray 75-100%), which contradicts "the entire fill segment becomes red — NOT a static gradient."

**Revised recommendation: two stacked fills with a synchronous opacity flip at half-target.** Both layers grow with the same `animate-fill-bar` keyframe over the full `perQuestionTargetMs`. The blue layer is fully opaque during phase 1 and fully transparent during phase 2; the red layer is fully transparent during phase 1 and fully opaque during phase 2. Implementation:

- Add to `src/styles/unstyled/globals.css`:

  ```css
  @keyframes opacity-visible-then-hidden {
      0%      { opacity: 1; }
      49.99%  { opacity: 1; }
      50%     { opacity: 0; }
      100%    { opacity: 0; }
  }
  @keyframes opacity-hidden-then-visible {
      0%      { opacity: 0; }
      49.99%  { opacity: 0; }
      50%     { opacity: 1; }
      100%    { opacity: 1; }
  }
  ```

- Primary bar's blue fill: animated by both `animate-fill-bar` (transform) and `opacity-visible-then-hidden` (opacity), same duration.
- Primary bar's red fill: animated by both `animate-fill-bar` (transform) and `opacity-hidden-then-visible` (opacity), same duration.
- Both layers start at the same time on item mount.

The 49.99% / 50% pair gives the discrete flip. CSS animation interpolation at exactly 50% is undefined across browsers; the 0.01% gap forces a discrete jump.

### Implementation seam — overflow bar fill

Structurally identical to today's `<QuestionTimerBar>`: gray track + single red fill with `animate-fill-bar` over `[animation-duration:18000ms]`. The only difference is `[animation-delay:18000ms]` — fill starts 18s after item mount.

Tailwind needs to extract the delay class. Either:

- Add `[animation-delay:18000ms]` as a literal class string in the source (Tailwind v4 JIT picks it up as an arbitrary property).
- Or add a `DELAY_CLASS_BY_MS` map in `timer-bar.tsx` mirroring `DURATION_CLASS_BY_MS`.

The first form is simpler for a single delay value. Use it; if speed-ramp / brutal modes ever need a different per-question target, refactor to the map at that point.

### Reducer / state changes

None. `state.elapsedQuestionMs` already exists and is what drives the existing single bar. The new layered structure consumes only `itemId` and `perQuestionTargetMs` from props, same as today.

### Verification scenarios

`playwright-core` measurements at multiple time samples on the smoke route (using `?per-question` smoke flag if added, or 18s wall-clock):

| t (ms) | Primary expected fill ratio | Primary expected color | Overflow expected fill ratio | Overflow expected color |
|---|---|---|---|---|
| 0 | 0.00 | (none — empty) | 0.00 | (none — empty) |
| 4500 | 0.25 | blue | 0.00 | empty |
| 8990 | ~0.5 | blue | 0.00 | empty |
| 9010 | ~0.5 | red | 0.00 | empty |
| 13500 | 0.75 | red | 0.00 | empty |
| 17990 | ~1.0 | red | 0.00 | empty |
| 18010 | 1.0 (capped) | red | ~0.001 | red |
| 22500 | 1.0 (capped) | red | 0.25 | red |
| 27000 | 1.0 | red | 0.5 | red |
| 36000 | 1.0 | red | 1.0 | red |
| 50000 | 1.0 | red | 1.0 (capped) | red |

Each row is a sample. Capture via `getBoundingClientRect().width` of `[data-testid="question-timer-primary-fill"]` (sum across both layers' bounding rects, or pick whichever has opacity > 0) divided by the track's width. Color via `getComputedStyle(...).backgroundColor`, asserting against the lab() form of `bg-blue-600` and `bg-red-600` from the project's Tailwind config.

Mouse movement to (10, 10) before each measurement to clear hover state, per the established protocol.

Color-flip verification specifically: capture at t=8990ms and t=9010ms (40ms apart, straddling the half-target boundary). Assert primary's visible color is blue at t=8990 and red at t=9010. The 20ms tolerance window accounts for animation interpolation.

## 7. Item 6 — Question progression bar color-keyed to pace deficit (FEATURE)

### What's missing

`<QuestionProgressionBar>` (post-commit 3) renders all filled segments solid blue, regardless of session pacing. There's no visual signal when the user is consuming time faster than questions — a state where the user is on track to run out the session timer before completing the question target.

### What it should do

When the user is "behind pace" — defined as `elapsedSessionMs / sessionDurationMs > currentQuestionIndex / targetQuestionCount` — the progression bar's filled segments turn red. When ahead of pace (or exactly on pace), they stay blue.

Specifics:

- The color flip is **all filled segments at once**, not segment-by-segment. K filled segments turn red when behind, all blue when ahead.
- Strict greater-than comparison: equal time-ratio and questions-ratio is "on pace" → blue.
- Diagnostic case (`sessionDurationMs === null`): blue always. There's no pace to compare against.
- Threshold check is per-render (driven by the existing RAF tick), not edge-triggered. The user can flicker between behind and ahead if they answer fast enough to catch up — the bar reflects current state continuously.

Worked examples (from the user's prompt):

- Q2 of 50, t=10/15min: time ratio 0.67, questions ratio 0.02 → `0.67 > 0.02` → behind → RED.
- Q49 of 50, t=13/15min: time ratio 0.87, questions ratio 0.96 → `0.87 > 0.96` → false → ahead → BLUE.

### Implementation seam

Recommend: compute `behindPace` in `<FocusShell>`, pass to `<QuestionProgressionBar>` as a new `behindPace: boolean` prop. Keeps the bar component a pure presenter; aligns with the existing pattern where the shell owns timer state and the bar components just render.

In `focus-shell.tsx`:

```tsx
const currentQuestionIndex = props.targetQuestionCount - state.questionsRemaining
const behindPace =
  sessionDurationMs !== null &&
  state.elapsedSessionMs / sessionDurationMs > currentQuestionIndex / props.targetQuestionCount

// pass to <QuestionProgressionBar behindPace={behindPace} ... />
```

In `question-progression-bar.tsx`:

```tsx
interface QuestionProgressionBarProps {
  totalQuestions: number
  questionsRemaining: number
  behindPace: boolean        // NEW
}

// inside renderSegment:
const fillClass = filled
  ? (behindPace ? "bg-red-600" : "bg-blue-600")
  : "bg-gray-200"
```

The diagnostic case is handled by the `sessionDurationMs !== null` clause in the shell's computation — if duration is null, `behindPace` is always false, segments stay blue. No conditional inside the bar.

The legacy `paceTrackVisible` prop on `FocusShellProps` (vestigial per the comment at `focus-shell.tsx:339`) is unrelated and untouched.

### Reducer / state changes

None. The computation is derived from existing state (`elapsedSessionMs`, `questionsRemaining`) and props (`sessionDurationMs`, `targetQuestionCount`).

### Verification scenarios

Drive the smoke route with three scripted scenarios:

1. **Ahead-of-pace baseline**: cold start of a 5-question drill (90s session). At t=1s on question 1: time ratio 0.011, questions ratio 0.0 → behind (any time ratio > 0 is behind on question 1). Sample the segment color via `getComputedStyle`. Assert red.
2. **Behind by construction**: same drill, wait until t=20s on question 1: time ratio 0.22, questions ratio 0.0 → behind. Assert red.
3. **Catch up**: submit through to question 5 quickly (within ~10s wall). At question 5 with elapsed ~10s: time ratio 0.11, questions ratio 0.8 → ahead. Assert blue. (Question 5 catches up because the question ratio jumped to 0.8.)
4. **Diagnostic exemption**: navigate to `/diagnostic/run`. Sample the segment color. Assert blue regardless of elapsed time (the prop sees `sessionDurationMs === null` and short-circuits).

Note: scenarios 1-3 above use `currentQuestionIndex` which is the index of the *current* question (0-based). On question 1 of 5, currentQuestionIndex = 0, questions ratio = 0. The behind-pace condition `time > 0` is always true the moment any time has elapsed on question 1 — meaning the bar is red from the very start of every drill. This is consistent with the user's spec (Q2 of 50 at 10/15 min has questions ratio 1/50 = 0.02; the user computes the ratio based on the current question's index).

Worth flagging: if the user wants the bar to be blue at the start of question 1 (when "0% through" both axes is on-pace by intuition), the threshold should use `currentQuestionIndex + 1` instead of `currentQuestionIndex` for the questions-ratio side. As specified in the prompt, current rule is `currentQuestionIndex / targetQuestionCount`, which makes Q1 always start red. Confirm with the user before implementation; this is an open question (see §11).

## 8. Sequencing and commits

Five commits, in order:

1. **`fix(focus-shell): reset interactivity state on advance after triage take`** — item 1. Reducer-only change (`reduceAdvance` adds `submitPending: false` reset) plus `pointer-events-none` on `<InterQuestionCard>`. Optional `useLayoutEffect` for `syncStateRef`. Verification: regression test that drives a triage-take advance and asserts the next item's option-click registers.
2. **`feat(focus-shell): replace tick/dong audio with random session-picked looping sample`** — items 2-4 collapsed. Adds `data/sounds/` directory + `data/sounds/LICENSE.md` (Leo curates the actual sound files separately; the commit can land with an empty bank and the implementer adds 1-2 placeholder samples for verification). Adds `scripts/copy-sounds-to-public.ts` (or hooks into existing asset-copy). Rewrites `audio-ticker.ts` with `pickSessionSound`, `startUrgencyLoop`, `stopUrgencyLoop`. Simplifies `focus-shell.tsx`'s `maybePlayAudio` effect to start/stop on target-cross and advance. New `urgencyLoopStartedForCurrentQuestion` flag in `ShellState`. Removes `dongPlayedForCurrentQuestion` and the `dong_played` action variant.
3. **`feat(focus-shell): split per-question timer bar into stacked primary+overflow bars with phase-keyed primary fill`** — item 5. New `<QuestionTimerBarStack>` wrapper, renamed `<QuestionTimerBarPrimary>`, new `<QuestionTimerBarOverflow>`. Two new keyframes in `globals.css`. `<FocusShell>` import swap. Largest commit in the round.
4. **`feat(focus-shell): color-key question progression bar to pace deficit`** — item 6. New `behindPace` prop on `<QuestionProgressionBar>`, computation in `<FocusShell>`. Smallest feature commit.
5. **`docs: update SPEC §6 and architecture_plan for post-overhaul fixes`** — wrap-up doc commit. SPEC §6.6 grows a row for the overflow bar; SPEC §6.12 (audio cues) is rewritten around the urgency-loop model (replacing the old tick/dong description); SPEC §6's bar-color discussion gets a paragraph on pace-keying. `architecture_plan.md`'s focus-shell paragraph picks up the dual-bar and pace-keyed rendering in one sentence each, plus a one-line note about the random session-picked loop.

Each commit lands lint-clean, typecheck-clean, and verification-pass. No commit blocks on a later commit's work.

## 9. Verification protocol carry-forward

Established discipline from commits 1-7 carries forward unchanged:

- `playwright-core` directly with `page.screenshot({ timeout: 30_000 })`. No MCP `browser_take_screenshot` calls (the MCP tool's hardcoded 5s timeout has bitten this protocol once already).
- `page.mouse.move(10, 10)` before any post-click `getComputedStyle` measurement, to clear hover state.
- Multi-sample timing measurements for animated bars — multiple time points across the animation curve, not single snapshots. The dual-bar item especially needs this; a single sample at t=18s would miss the color flip.
- CustomEvent dispatch from new audio paths for harness instrumentation. The new event kinds (`urgency-loop-start`, `urgency-loop-stop`) replace the old `tick` / `dong` / `post-dong-tick` triple.
- Real-DB harness for any item that touches the server-action path. Item 1 needs a real drill (not the smoke route's stub `onSubmitAttempt`) because the bug is on the post-network-roundtrip path. Items 2-6 can use the smoke route since they don't depend on server behavior.
- For the bug fix specifically: a regression test that drives a triage-take advance and asserts the next item's option-click registers a state change. Run on `main` BEFORE the fix to confirm the harness reproduces the bug; run again after to confirm the fix.

The harness scaffolding from commit 7 (`/tmp/c7-harness.ts.bak`, the auth-cookie-injection helper) is reusable — copy into a new throwaway script under `scripts/_*-harness.ts`, run, then move out of the project tree before commit so `tsgo` doesn't complain about per-harness type errors.

## 10. Out of scope

Explicit list — anything below stays untouched in this round:

- Changes to the triage prompt's content or rendering. The prompt fires correctly; only post-take state-reset is broken.
- Changes to `sessionDurationMs` semantics or the auto-redirect from commit 7.
- Changes to the diagnostic flow (the `sessionDurationMs === null` exemption flows through unchanged).
- New audio for non-question events (session-end, item-correct, etc.).
- Changes to the question text or option text typography (commit 8 ended that thread).
- A "behind pace" warning beyond the progression-bar color — no toast, no banner, no overlay.
- A configurable per-question target. 18s stays the v1 target; 12s for speed-ramp stays untouched.
- The vestigial `paceTrackVisible` prop on `FocusShellProps`. Still unread; remove in a future cleanup commit, not here.
- **Per-user audio preferences** (e.g., a user toggle for "skip the urgency loop"). The existing `timerPrefs.questionTimerVisible` toggle gates the loop the same way it gated the old dong; no separate audio toggle ships in v2.
- **Sound bank curation as part of the implementation commit.** Leo curates `data/sounds/` separately. Commit 2 lands with placeholder samples (1-2 short test files) that exercise the random-pick path. Replacement of placeholders with curated content is a follow-up edit Leo handles.
- **Pre-dong audio of any kind.** v2 deliberately removes the pre-dong tick. The only audio in the focus shell is the urgency loop that fires after the per-question target. Reintroducing a pre-target cue is a separate future decision.

Things noted during drafting that are out of scope for this plan but worth recording:

- **SPEC §6.2's `ShellState` / `ShellAction` shapes are still stale** (referenced in commit 5's commit message). They don't reflect `submitPending`, `urgencyLoopStartedForCurrentQuestion`, or `sessionEnded`. Refresh belongs in a separate doc-only commit with the §6.8 keyboard-shortcut and §6.10 diagnostic-overtime cleanups.
- **SPEC §6.10 diagnostic-overtime-note text describes machinery that was removed** in the polish-plan; the §6.7 cross-reference from commit 5 currently points at obsolete text. Same separate doc commit.
- **The `<TriagePrompt>` overlay's `z-50` and the `<InterQuestionCard>`'s implicit z-auto could collide** in unusual stack contexts (e.g., a future modal on top of the focus shell). Not a current bug; flag for whoever introduces such a modal.
- **Two reds in the chrome row** — the session timer bar's red fill (absolute time elapsed) and the progression bar's red fill (pace deficit) — coexist intentionally. Same red token, different signals. Worth flagging in the SPEC §6 doc commit so future eyes don't read it as visual confusion.

## 11. Open questions for Leo

Questions that surfaced during drafting and need a decision before implementation:

1. **Item 6's threshold semantics on question 1.** As specified, `currentQuestionIndex / targetQuestionCount` is `0 / 5 = 0` on question 1 of 5, so any elapsed time triggers behind-pace red from t=0+. Is this the intended behavior? The user's worked examples (Q2 of 50, Q49 of 50) both use the index-based ratio and accept this semantics. If the user wants Q1 to start blue, the questions ratio should be `(currentQuestionIndex + 1) / targetQuestionCount` instead — same threshold logic, off-by-one shift.
2. **Sound-bank initial seed.** When commit 2 lands, the implementer needs at least one MP3 file in `data/sounds/` to verify the random-pick path works. Two options: (a) Leo provides 1-2 starter files before the commit, OR (b) the implementer generates a placeholder via a free CC0 sample (e.g., a generic "tick" sound from freesound.org), commits it with a note in `data/sounds/LICENSE.md`, and Leo replaces it post-commit with the real curated bank. Which path?
3. **Sound-manifest discovery mechanism.** Two options: (a) a build-time-generated `src/config/sound-bank.ts` whose contents are derived from `data/sounds/*.mp3` at build, OR (b) a runtime fetch to a `/api/audio/sounds-manifest` endpoint that lists files in `public/audio/sounds/`. Option (a) is simpler and ships zero runtime API surface; option (b) lets the bank be updated without redeploy. v2's plan defaults to (a) — confirm.
4. **Item 1's `useLayoutEffect` for `stateRef` sync.** The candidate-#3 mitigation is cheap to apply preemptively but technically out of scope if candidate #3 doesn't reproduce. Apply it always (defense-in-depth) or skip unless reproduced?