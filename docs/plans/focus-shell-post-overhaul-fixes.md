# Plan — Focus-shell post-overhaul fixes and features

> **Status: drafted 2026-05-03; pre-implementation.** Six items grouped into one round, slated for the next implementation pass after the focus-shell overhaul (commits `3734b5c..415d969`) lands. Hashes will land here once the work commits.

The focus-shell overhaul shipped a structurally-correct shell — three bars in the chrome row, audio cues at the per-question target, session-timer auto-redirect, typography aligned to the target screenshots. Dogfooding then surfaced one regression and five tuning items. The regression (a triage-take dead-end) blocks Phase 3 dogfooding entirely; the rest are tuning that the user noticed once the structural work was out of the way. They land together because they share the same component surface and the same playwright-core verification protocol — verifying them together amortizes the harness setup cost.

## 1. Why these six items, why now

The six items cluster into three themes:

- **Triage post-flow integrity (item 1).** A regression: after the user takes the triage prompt, the new item paints but doesn't accept input. This is a load-bearing bug — without a working triage take, the pedagogical core of the focus shell (the "abandon and advance" decision) can't be exercised. Highest priority; blocks dogfooding.
- **Audio escalation discipline (items 2, 3, 4).** The synthesized dong is too gentle; the pre-dong tick is too quiet; the silence past the target lets users linger without escalation. Three coordinated changes to make the audio do its job — communicating "your time is up, stop dithering."
- **Richer timing visualization (items 5, 6).** Two visual upgrades that the existing one-bar / one-color shell can't express: a second per-question bar to show overtime budget without changing the "no auto-submit" rule, and a pace-deficit color flip on the question progression bar so users can see at a glance whether they're behind on the session as a whole.

The bug fix MUST land first, in its own commit, so subsequent feature commits can verify against a working triage flow. After the bug fix, the audio commits and then the visual commits — audio is cheaper to verify than the dual-bar visual, and the visual commit is the riskiest item in the round.

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

## 3. Item 2 — Replace synthesized dong with a Chinese gong sample (FEATURE)

### What's missing

`audio-ticker.ts:63-83` synthesizes the dong as a 220Hz sine wave with a 10ms attack, 0.3 peak gain, 290ms exponential decay to 0.001 — total ~300ms. It signals "time's up" but feels gentle in dogfooding; users keep working on the question without internalizing the cue. The user wants a real Chinese gong: louder, longer (~2-3s of natural decay), inharmonic — a sound the human ear processes as "stop, look up."

### What it should do

Play a real gong audio sample at the moment `elapsedQuestionMs` first crosses `perQuestionTargetMs`. Once per question. Same gating as today: only fires when `timerPrefs.questionTimerVisible === true`; only fires after `unlockAudio()` has been called (browser autoplay policy); silent no-op when the AudioContext is suspended or absent.

Specifically:

- **Source**: a CC0 / public-domain Chinese gong sample bundled into the repo at `public/audio/gong.mp3` (or `.ogg`; pick the smaller file at acceptable quality). Sourced from freesound.org, OpenGameArt, or BBC Sound Effects (CC-0 collection). Licensing diligence: write the source URL + license terms into a sibling `public/audio/LICENSE.md`. ~50-150KB target file size; mono, ~22 or 44 kHz, ~3 second duration including decay.
- **Peak gain target**: ~0.7-0.85. Loud enough to be unmissable at default OS volume; quiet enough to not clip on systems with their volume cranked. The Web Audio API multiplies our gain by the OS / tab volume, so "louder" is relative — what we set is the upper bound at OS volume = 100%.
- **Playback path**: extend `audio-ticker.ts` with a new module-level `AudioBuffer | undefined` for the decoded gong. On first `unlockAudio()` invocation, kick off `fetch('/audio/gong.mp3') → ArrayBuffer → audioCtx.decodeAudioData()` and store the result. `playDong()` becomes "create an `AudioBufferSourceNode` from the decoded buffer, connect through a `GainNode` set to ~0.8, start at `currentTime`." If decode hasn't completed by the time `playDong()` is called (network latency on first session), fall through to the existing synth as a last-resort fallback so question 1 still produces a sound.
- **CustomEvent compatibility**: keep the `audio-ticker` CustomEvent dispatch (`emitEvent("dong")`) at the same call site. Harnesses that count `dong` emissions don't need to change.

### Implementation seam

Single file: `src/components/focus-shell/audio-ticker.ts`.

- Add module-level `let gongBuffer: AudioBuffer | undefined`.
- Inside `unlockAudio`, after creating the AudioContext, kick off an async load: `fetch + decode + assign`. Wrap in `errors.try` per the ruleset; on error log via `logger.warn` (not error — it's a graceful-degradation path) and leave `gongBuffer` undefined.
- Rewrite `playDong` to use the buffer when available; keep the synth path as the fallback.
- Add `public/audio/gong.mp3` and `public/audio/LICENSE.md`.

No reducer changes. No FocusShell changes. No new exports.

### Reducer / state changes

None.

### Verification scenarios

1. **Sample plays, not synth**: open the smoke route, wait for the dong (or fast-forward). Use `audioCtx.decodeAudioData` instrumentation via `page.evaluate`-injected wrapper to confirm an `AudioBufferSourceNode` was used (not an `OscillatorNode`). Capture the duration of the played buffer (~3s vs. 0.32s for synth).
2. **CustomEvent still fires once**: assert exactly one `dong` event per question.
3. **First-question fallback**: simulate a network-delayed load (intercept the `/audio/gong.mp3` request via Playwright `page.route` and delay the response by 10s). Cross the per-question target before the load completes. Assert the synth dong played (oscillator created); assert the CustomEvent still fired.
4. **Peak gain bound**: programmatic check via the Web Audio API — assert the GainNode's `gain.value` is ≤ 0.85 at any point during playback (no clipping risk).
5. **Quiet when timer hidden**: navigate to `?qt=false`; cross the target; assert zero `dong` CustomEvents.

## 4. Item 3 — Continue ticking past the per-question target (FEATURE)

### What's missing

After the dong fires at `perQuestionTargetMs`, audio goes silent. The user can linger indefinitely with no auditory escalation. SPEC §6.7's "no auto-submit at any time during a question; the session timer is the only hard cutoff" stays — but silence is not the right signal. The user wants escalating auditory pressure that makes lingering uncomfortable but not impossible.

### What it should do

After the dong, fire a **distinct, harsher tick once per integer second** while the user is still on the same question. Stops on `advance`.

- Firing condition: every integer second `s` where `elapsedQuestionMs >= perQuestionTargetMs` AND `s` has not yet been ticked. NOT gated by `dongPlayedForCurrentQuestion` — the dong gates itself at the target; the post-dong tick gates only on "we've crossed the target." First post-dong tick fires at `perQuestionTargetMs + 1s` (i.e., second 19 of an 18s target); subsequent ticks at seconds 20, 21, 22, … until the user advances.
- Audio character: lower-pitched than the pre-dong tick (which is 880 Hz). Recommend ~180-220 Hz fundamental, square wave, 60-80ms duration with a 5ms attack and a hard cutoff (no exponential tail — gives it the "blocky" feel). Optional second oscillator detuned by 7 Hz for a perceptible buzz. Peak gain ~0.5-0.6 (audibly louder than the pre-dong tick, audibly quieter than the gong sample, and uncomfortable to hear repeatedly without being painful).
- **Distinct sonic signature**: pre-dong tick = soft sine pip, dong = gong sample, post-dong tick = buzzy square pulse. Three discrete sounds, easy to identify by ear without looking at the screen.
- Reset on `advance` so question 2's post-dong tick state starts clean.

### Implementation seam

`audio-ticker.ts` + `focus-shell.tsx`.

- New `playPostDongTick()` export in `audio-ticker.ts` mirroring `playTick`'s shape (Web Audio synth, `errors.trySync` wrap, `audio-ticker` CustomEvent with `kind: "post-dong-tick"`). The `kind` literal type union expands to `"tick" | "dong" | "post-dong-tick"`.
- Inside `focus-shell.tsx`'s existing `maybePlayAudio` effect (line ~246), extend the cross-second loop to fire `playPostDongTick()` for any `s` where `s > targetSec`. The existing pre-dong tick fires for `s > halfSec && s < targetSec`; the dong fires for `s >= targetSec` (one-shot, gated by `dongPlayedRef`). The post-dong tick fits as a third branch: `s > targetSec` (one fire per second crossed, no dedup beyond the cross-second-detection logic that already prevents double-fires within a single render batch).
- The reset effect at `focus-shell.tsx:235` (resetAudioOnItemAdvance) already resets `prevSecondRef` and `dongPlayedRef` on item advance. Post-dong tick uses the same `prevSecondRef` cross-second logic, so the existing reset is sufficient — no new ref needed.

### Reducer / state changes

None. The cross-second loop in `focus-shell.tsx` deduplicates within a render batch via `prevSecondRef`; the reducer's `dongPlayedForCurrentQuestion` flag continues to dedupe the dong specifically. The post-dong tick doesn't need its own dedup field because the cross-second logic already handles "fire once per second crossed" — and a missed second (e.g., backgrounded tab) is fine; we don't want to spam-fire all the missed seconds when the tab returns.

Actually — one subtlety. The current cross-second loop fires every second between `prevSecondRef + 1` and `secondsElapsed` inclusive. If the tab is backgrounded for 10 seconds and then refocused, on the next RAF tick the loop fires 10 ticks in rapid succession (all queued for `audioCtx.currentTime`, so they overlap). For pre-dong ticks this is mildly annoying; for post-dong ticks, 10 buzzy ticks at once is a klaxon. Add a guard: when `secondsElapsed - prevSecondRef > 2`, only emit the most recent second's tick. Keeps the post-tab-focus behavior sane without complicating the normal foreground path.

### Verification scenarios

1. **Post-dong tick cadence**: cross the per-question target on the smoke route. Capture `audio-ticker` CustomEvents for 5 seconds past target. Assert exactly 5 events with `kind: "post-dong-tick"` at ~1s intervals (±50ms tolerance).
2. **Stops on advance**: cross target, let 3 post-dong ticks fire, click an option and Submit. Assert no further `post-dong-tick` events fire on the next item.
3. **Audio character**: programmatic check — assert the OscillatorNode's `type` is `"square"` (not `"sine"`) and `frequency.value` is in [180, 220].
4. **Backgrounded-tab dedup**: simulate by suspending the AudioContext for 10 seconds via `audioCtx.suspend()`, then resuming. Assert only one post-dong-tick event fires on resume (not 10).
5. **Coexists with pre-dong ticks and dong**: full sequence — at 18s target, expect 8 `tick` events (seconds 10-17), 1 `dong` event (second 18), then `post-dong-tick` events from second 19 onwards.

## 5. Item 4 — Increase tick volume across the board (FEATURE)

### What's missing

`playTick`'s peak gain is 0.12 (`audio-ticker.ts:53`). At default OS volume on most laptops this is barely audible. The user wants pre-dong ticks loud enough to be a clear "approaching deadline" cue — not a klaxon, but unmissable.

### What it should do

- **Pre-dong tick** (`playTick`): peak gain 0.12 → 0.55. Keep the 5ms attack (any shorter risks a click artifact).
- **Post-dong tick** (`playPostDongTick`, new in item 3): peak gain ~0.55 (same as pre-dong, distinctness comes from waveform + pitch, not volume).
- **Dong**: if item 2 lands the gong sample, peak gain 0.7-0.85 as specified in §3. If item 2 lands the synth fallback, the synth dong's peak gain stays at 0.3 (it's the fallback only).

### Implementation seam

If items 2 and 3 land before item 4, the gain bumps fold into those commits naturally — there's no shared infrastructure to extract. Item 4 is a one-line change to `playTick`'s `linearRampToValueAtTime` call. Recommend folding into the same commit as item 3 (post-dong tick), since both are pre-dong-tick-adjacent gain decisions and both touch `audio-ticker.ts`.

### Reducer / state changes

None.

### Verification scenarios

Programmatic check via `page.evaluate` reading the GainNode's `gain` envelope:

1. After `playTick()` fires, assert `peakGain > 0.4` and `peakGain < 0.7`. Loose-bound assertion since the linear-ramp interpolation makes exact-value testing fragile.
2. Confirm no clipping — assert `peakGain < 1.0` (the AudioContext's `destination` clips at 1.0).
3. Subjective sign-off via dogfood: not testable in CI, but the implementer should listen on a default-volume laptop and confirm the tick is "audible without leaning in."

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

  Both keyframes get Tailwind utility shortcuts (`animate-opacity-vth` / `animate-opacity-htv`) registered in the same way `animate-fill-bar` is registered today.

- Primary bar markup (inside `<QuestionTimerBarPrimary>`):

  ```tsx
  <div className="relative h-1 w-full overflow-hidden rounded-sm bg-gray-200">
    {/* blue layer: visible 0→half, hidden half→target. transform animates over full target. */}
    <div className={cn(
      "absolute inset-0 origin-left animate-fill-bar animate-opacity-vth bg-blue-600",
      durationClass  // [animation-duration:18000ms]
    )} key={itemId} />
    {/* red layer: hidden 0→half, visible half→target. transform animates over full target. */}
    <div className={cn(
      "absolute inset-0 origin-left animate-fill-bar animate-opacity-htv bg-red-600",
      durationClass
    )} key={itemId} />
  </div>
  ```

  Both layers start animating at the same time (`animation-delay: 0`). Both reach scaleX(1) at t = target. The opacity animations flip discrete at t = target/2. Visually: blue grows 0→50%, then disappears; red has been simultaneously growing 0→50% but invisible, and at t=target/2 becomes visible at exactly the same scaleX as blue had reached. From t=target/2 onwards, only red is visible, growing 50%→100%.

  At t = target (and beyond), `animation-fill-mode: forwards` (declared in globals.css for `animate-fill-bar`) holds the final state. Red stays at scaleX(1), opacity 1.

The two `key={itemId}` props ensure both layers' animations restart together on item advance.

This approach matches the existing pattern (Tailwind keyframe + arbitrary-property duration class), satisfies the spec ("entire fill is one color at a time, discrete flip"), and keeps render cost flat (CSS animation, not React state per frame).

### Implementation seam — overflow bar

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

Seven commits, in order:

1. **`fix(focus-shell): reset interactivity state on advance after triage take`** — item 1. Reducer-only change (`reduceAdvance` adds `submitPending: false` reset) plus `pointer-events-none` on `<InterQuestionCard>`. Optional `useLayoutEffect` for `syncStateRef`. Verification: regression test that drives a triage-take advance and asserts the next item's option-click registers.
2. **`feat(focus-shell): bundle and play Chinese gong sample for question-target dong`** — item 2. New `public/audio/gong.mp3` + LICENSE.md. `audio-ticker.ts` extended to load and play the buffer with synth fallback. Peak-gain bumped to ~0.8 in this commit (per item 4 for the dong specifically).
3. **`feat(focus-shell): emit harsher tick after question target until advance`** — item 3 + item 4 folded in. New `playPostDongTick()` export, new `kind: "post-dong-tick"` CustomEvent variant, post-target firing branch in `maybePlayAudio`, backgrounded-tab dedup guard. Pre-dong tick gain bump (0.12 → 0.55, item 4) folded into the same commit since both touch `audio-ticker.ts`.
4. **`feat(focus-shell): split per-question timer bar into stacked primary+overflow bars with phase-keyed primary fill`** — item 5. New `<QuestionTimerBarStack>` wrapper, renamed `<QuestionTimerBarPrimary>`, new `<QuestionTimerBarOverflow>`. Two new keyframes in `globals.css`. `<FocusShell>` import swap. Largest commit in the round.
5. **`feat(focus-shell): color-key question progression bar to pace deficit`** — item 6. New `behindPace` prop on `<QuestionProgressionBar>`, computation in `<FocusShell>`. Smallest feature commit.
6. **`docs: update SPEC §6 and architecture_plan for post-overhaul fixes`** — wrap-up doc commit. SPEC §6.6 grows a row for the overflow bar; SPEC §6.12 (audio cues) gains the post-dong tick paragraph; SPEC §6's bar-color discussion gets a paragraph on pace-keying. `architecture_plan.md`'s focus-shell paragraph picks up the dual-bar and pace-keyed rendering in one sentence each.

Item 4 is folded into commit 3 (items 4 and 3 both modify `audio-ticker.ts`'s synth code; one commit is cleaner than two). The dong-specific gain bump (item 4 for the dong) is folded into commit 2 since the gong sample's playback path is where that gain value lives.

Each commit lands lint-clean, typecheck-clean, and verification-pass. No commit blocks on a later commit's work.

## 9. Verification protocol carry-forward

Established discipline from commits 1-7 carries forward unchanged:

- `playwright-core` directly with `page.screenshot({ timeout: 30_000 })`. No MCP `browser_take_screenshot` calls (the MCP tool's hardcoded 5s timeout has bitten this protocol once already).
- `page.mouse.move(10, 10)` before any post-click `getComputedStyle` measurement, to clear hover state.
- Multi-sample timing measurements for animated bars — multiple time points across the animation curve, not single snapshots. The dual-bar item especially needs this; a single sample at t=18s would miss the color flip.
- CustomEvent dispatch from new audio paths for harness instrumentation, mirroring the `audio-ticker` event from commit 6. The new `kind: "post-dong-tick"` variant is the principle extended one step.
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

Things noted during drafting that are out of scope for this plan but worth recording:

- **SPEC §6.2's `ShellState` / `ShellAction` shapes are still stale** (referenced in commit 9's commit message). They don't reflect `submitPending`, `dongPlayedForCurrentQuestion`, or `sessionEnded`. Refresh belongs in a separate doc-only commit with the §6.8 keyboard-shortcut and §6.10 diagnostic-overtime cleanups.
- **SPEC §6.10 diagnostic-overtime-note text describes machinery that was removed** in the polish-plan; the §6.7 cross-reference from commit 9 currently points at obsolete text. Same separate doc commit.
- **The `<TriagePrompt>` overlay's `z-50` and the `<InterQuestionCard>`'s implicit z-auto could collide** in unusual stack contexts (e.g., a future modal on top of the focus shell). Not a current bug; flag for whoever introduces such a modal.
- **Two reds in the chrome row** — the session timer bar's red fill (absolute time elapsed) and the progression bar's red fill (pace deficit) — coexist intentionally. Same red token, different signals. Worth flagging in the SPEC §6 doc commit so future eyes don't read it as visual confusion.
- **The pre-dong tick frequency (880 Hz) and the post-dong tick frequency (~200 Hz)** form a tritone-ish interval. Acceptable for v1; if the audio designer eventually weighs in, frequencies may shift. No decision needed now.

## 11. Open questions for Leo

Questions that surfaced during drafting and need a decision before implementation:

1. **Item 6's threshold semantics on question 1.** As specified, `currentQuestionIndex / targetQuestionCount` is `0 / 5 = 0` on question 1 of 5, so any elapsed time triggers behind-pace red from t=0+. Is this the intended behavior? The user's worked examples (Q2 of 50, Q49 of 50) both use the index-based ratio and accept this semantics. If the user wants Q1 to start blue, the questions ratio should be `(currentQuestionIndex + 1) / targetQuestionCount` instead — same threshold logic, off-by-one shift.
2. **Item 2's gong sample sourcing.** This plan recommends a CC0 sample from freesound.org / OpenGameArt / BBC Sound Effects. Does the user want to source the file, or pick from candidates the implementer surfaces? The licensing diligence is a one-time cost; whoever picks the file owns the LICENSE.md write.
3. **Item 1's `useLayoutEffect` for `stateRef` sync.** The candidate-#3 mitigation is cheap to apply preemptively but technically out of scope if candidate #3 doesn't reproduce. Apply it always (defense-in-depth) or skip unless reproduced?
4. **Folding item 4's dong-gain bump into item 2's commit, and item 4's tick-gain bump into item 3's commit.** This plan assumes yes (cleaner diffs, both touch the same file as the parent commit). Confirm — or split item 4 into its own commit if the user prefers atomic commits per logical unit.
