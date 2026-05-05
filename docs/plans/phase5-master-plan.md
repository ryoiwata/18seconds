# Plan — Phase 5 master arc: engine completeness

> **Status: planning, approved, not yet implemented.** This is a master plan — sub-phase carving only. NO per-sub-phase implementation detail; those plans get drafted at each sub-phase's start, against then-current state, the way Phase 3's four sub-phase plans were (`docs/plans/phase3-{diagnostic-flow,mastery-map,drill-mode,heartbeats-and-cron}.md`).

Phase 5 is the next major engine-completeness arc after Phase 3 closed end-to-end on 2026-05-04. Per `docs/architecture_plan.md` line 66: *"Adaptive difficulty (drills) + spaced-repetition queue + review session + speed-ramp/brutal modes + question-timer toggle + NarrowingRamp + strategy review gate + full-length test."* Plus the roadmap's Round E foundation pieces: post-session review surface, click-to-highlight, dojo mode UI. The work clusters into seven sub-phases that ship sequentially with explicit dependencies; sub-phase 1 lands the foundation surface that several others build on, sub-phase 2 closes the adaptive-difficulty deferral that several others depend on, and the rest layer features in dependency order.

## 1. Why this round, why now

Three forcing functions:

1. **Phase 3 closed clean.** Sub-phases 1 + 2 + 3 + 4 shipped the user-facing happy path and the background-state-management infrastructure. No outstanding-and-blocking items from Phase 3 carry into Phase 5.

2. **Engine completeness is the next coherent arc.** Roadmap Round C (stats + history) is independent and could ship before, after, or in parallel; Round D (Phase 4 LLM generation) is sequenced post-Phase-5 per the candidate-promotion-shadow-mode rationale. That leaves Phase 5 as the next major user-visible arc.

3. **Round Bx (deploy-and-dogfood interlude) is being skipped per Leo's "no-deploy-until-feature-complete" decision.** The roadmap currently names Round Bx as the next move and states it "gates Phase 5 planning detail." That sequencing is explicitly being overridden — Phase 5 sub-phase planning starts now, against `main`'s current state, without dogfood signal informing the carve. **The roadmap will need a small amendment to flip Round Bx from "next" to "deferred until Phase 5 + post-Phase-5 rounds complete."** That amendment is a separate follow-up commit, not part of this master plan; flagging here so it doesn't get lost.

The cost of skipping dogfood is real but bounded: Phase 5's sub-phases each follow the audit-and-polish pattern that worked through Phase 3's four sub-phases — each sub-phase opens with an audit of `main`'s relevant state at sub-phase start, which catches drift the dogfood-signal would have surfaced earlier but doesn't prevent shipping. The accumulated SPEC §6.14 implementation notes (16 entries through Phase 3, especially .11 audit-tighter-than-contract, .14 uniform-response-code-for-ownership-opacity, .15 hermetic-smoke-with-per-run-isolation, .16 auth-shape audit) are the discipline that compensates.

## 2. Phase 5 scope inventory — partially shipped vs net-new

Phase 5's surface area is broad. To carve it cleanly, distinguish what `main` already carries vs what's net-new vs what's deliberately deferred to a later phase.

### Already partially shipped on `main`

- **Drill mode (uniform_band).** Sub-phase 3 closed. Drills run with a constant requested tier derived from `mastery_state` per SPEC §9.1's initial-tier table; tier-degraded fallback handles bank exhaustion. `selection.ts` carries `ErrAdaptiveDeferred` as a placeholder for the adaptive walker.
- **Diagnostic post-session form.** Sub-phase 1 shipped `<OnboardingTargets>` + the derived pacing-line at `/post-session/[sessionId]`. PRD §6.5's full review surface (accuracy-by-sub-type, median-latency-by-sub-type, triage score, wrong-items browser, surfaced strategies) is NOT yet built — only the onboarding form + pacing line.
- **Triage scoring (`triageRolling30d`, `triageScoreForSession`).** `src/server/triage/score.ts` from Phase 3. Already covers per-session and 30-day-rolling shapes; reusable by Phase 5's post-session review surface.
- **Mastery Map "Review (N due)" secondary action.** Plan `docs/plans/phase3-mastery-map.md` §6 explicitly deferred this until Phase 5 ships the review queue. No code surface yet.
- **`<FocusShell>` configuration props.** `sessionDurationMs`, `perQuestionTargetMs`, `paceTrackVisible`, `targetQuestionCount`, `initialTimerPrefs.questionTimerVisible` — all wired. Speed-ramp (12s perQuestionTargetMs) and brutal (brutal-only items) are config-flag additions; the focus-shell layer doesn't need internal changes.
- **Pure-function helpers.** `nextDueAtMs` (SPEC §9.5 SM-2 scheduler) is specced but not yet on `main`; `recomputeForUser`, `computeMastery`, `deriveNearGoal`, `recommendedNextSubType` all exist.

### Net-new for Phase 5

- Post-session review surface for every session type (PRD §6.5).
- Adaptive difficulty walker (closes `ErrAdaptiveDeferred`).
- Speed-ramp + brutal drill mode wiring (focus-shell config + per-mode initial-tier).
- Question-timer toggle (PRD §5.1 default-OFF + persisted prefs).
- Spaced-repetition queue (`review_queue` table + workflow + route + Mastery Map button).
- Full-length test (`/full-length` route + cross-sub-type-interleaved curve + 15-min session timer).
- 30-second strategy-review gate after full-length (PRD §6.5; `strategy_views` table interaction).
- Click-to-highlight in post-session explanation review (PRD §6.5 extension; consumes structured-explanation contract).
- NarrowingRamp pre-session protocol (PRD §5.3; obstacle scan / visual narrowing / session brief / countdown launch).
- Dojo mode UI rename + belt-indicator (PRD §4.2 extension; UI naming + tier visualization).

### Out of Phase 5 scope

- Test-day simulation (PRD §4.6) — Phase 6 per `docs/architecture_plan.md` build-sequencing.
- History tab (#10), stats dashboard (#6), independent timer (#8) — post-Phase-5 rounds with their own roadmap entries.
- Phase 4 LLM generation pipeline.
- Account deletion, candidate-promotion-cron-runner — Phase 6.

## 3. Sub-phase 1 — Post-session review surface

**Title.** Post-session review surface (PRD §6.5 foundation).

**Scope.** Build the post-session review screen that PRD §6.5 specifies: accuracy summary by sub-type (categorical ✓/✗, no percentages), median latency by sub-type with threshold marked, triage score, wrong-items browser (each shows prompt + options + correct answer + explanation), surfaced strategies for sub-types where the user struggled. Lands at `/post-session/[sessionId]` for drill + diagnostic. Replaces the diagnostic-only onboarding-form that Phase 3 sub-phase 1 shipped (the form moves into the new surface as a diagnostic-only section). Does NOT include: the 30-second strategy-review gate (full-length-only, sub-phase 4); click-to-highlight (sub-phase 5).

**Dependencies.** None within Phase 5; depends on Phase 3's `triageScoreForSession` + `mastery_state` + `attempts` schema (all on `main`).

**Rough commit count.** 4-6.

**Recommended sequencing position.** Sub-phase 1. Sub-phases 3 (spaced-repetition needs the post-session "got right but slowly" detection path), 4 (full-length needs the review surface for non-strategy-gate part), and 5 (click-to-highlight builds on top) all depend on this surface existing first.

**Cross-cutting concerns.** SPEC §6.5 update (post-session review schema + render). New components under `src/components/post-session/`. No schema migrations expected — all data already in `attempts` + `practice_sessions` + `items`. The surface needs `<WrongItemsBrowser>`, `<AccuracySummary>`, `<LatencySummary>`, `<StrategySurface>` components.

## 4. Sub-phase 2 — Adaptive difficulty walking

**Title.** Adaptive difficulty walker (closes `ErrAdaptiveDeferred`).

**Scope.** Implement `nextDifficultyTier` per SPEC §9.1: track running accuracy and latency over the last 10 in-session attempts on the current sub-type; step up when accuracy ≥ 90% AND latency comfortably under threshold; step down when accuracy ≤ 60% OR latency well above threshold; otherwise hold. Replace `selection.ts`'s `selectionStrategyForSession("drill", _) === "uniform_band"` with `"adaptive"`. The walker reads `served_at_tier` (not `items.difficulty`) so fallback-served items affect the walk based on what the user actually experienced. Per SPEC §9.1 the 0.8×/1.2× zone widths match PRD §4.2's "comfortably under" / "well above" framing.

**Dependencies.** None within Phase 5; the existing `mastery_state` + `attempts` schema and the `getNextUniformBand` shape carry forward.

**Rough commit count.** 3-4.

**Recommended sequencing position.** Sub-phase 2. Independent of sub-phase 1; runs in parallel if useful, but the carving lists it as 2 because sub-phases 6 and 7 depend on adaptive walking for their respective surfaces (speed-ramp/brutal are adaptive variants; dojo belt-indicator visualizes the adaptive walk).

**Cross-cutting concerns.** SPEC §9.1 + §9.2 reconciliation (the SPEC's `drill → adaptive` table row already matches the implementation that this sub-phase ships; the existing `Phase 5 changes the drill → uniform_band line to drill → adaptive` comment in `selection.ts:101-113` becomes the marker that lifts). No schema changes. Drill-mode smoke (`scripts/_sp3-audit.ts`-equivalent) needs re-run against the walker shape.

## 5. Sub-phase 3 — Spaced-repetition queue

**Title.** Spaced-repetition queue (PRD §4.3 SM-2 ladder).

**Scope.** Build `review_queue` table (the schema already specced per SPEC §3.5), the queue-refresh workflow that runs after every session and inserts items the user got wrong OR got right but slowly, the `/review` session route that pulls due items, the Mastery Map "Review (N due)" secondary action that surfaces when due items exist, and the SM-2 scheduler at `src/server/review/schedule.ts` per SPEC §9.5. The workflow's "got right but slowly" detection reads the post-session review surface's per-sub-type latency aggregation from sub-phase 1; pulling that aggregation forward to a non-UI workflow consumer is the cross-cutting concern.

**Dependencies.** Sub-phase 1 (post-session surface provides the latency aggregation the queue-refresh consumes). Independent of sub-phase 2 (the queue serves whatever items are due regardless of difficulty walker state).

**Rough commit count.** 5-7.

**Recommended sequencing position.** Sub-phase 3. Depends on sub-phase 1; otherwise unblocked. Could run before sub-phase 4 since they're independent.

**Cross-cutting concerns.** Schema migration: `review_queue` table (`(user_id, item_id)` primary key, `due_at_ms`, `last_interval_days`, `last_outcome`). Possibly a new column on `attempts` for "got right but slowly" flag (or compute on the fly from latency + threshold; decision deferred to sub-phase plan). New workflow `reviewQueueRefreshWorkflow` triggered from `endSession` alongside the existing `masteryRecomputeWorkflow`. SPEC §9.5 + §3.5 + §4.3 / PRD §4.3 updates.

## 6. Sub-phase 4 — Full-length test + strategy-review gate

**Title.** Full-length test (PRD §4.5) + 30s strategy-review gate (PRD §6.5).

**Scope.** Build `/full-length/run` route (server component initiating `startSession({ type: "full_length" })`), `src/config/full-length-mix.ts` with the 50-item cross-sub-type-interleaved difficulty curve (or sibling structure to `diagnostic-mix.ts` — naming/location decision deferred to sub-phase plan), 15-minute session timer (`sessionDurationMs: 900_000`), real-bank-first selection with generated-fallback (per PRD §4.5 "pulls from the real-items bank when possible"), and the 30-second strategy-review gate that fires after a full-length submit. The gate picks one strategy deterministically (lowest accuracy → highest median latency → lexicographic sub_type_id; least-recently-viewed strategy via `strategy_views` LEFT JOIN) and disables the post-session "Continue" button until 30 seconds elapse AND `<StrategyReviewGate>` reports the strategy was viewed; `dismissPostSession` enforces this server-side via `ErrStrategyReviewRequired`.

**Dependencies.** Sub-phase 1 (post-session review surface — the gate is post-session-specific UI on top of the existing review render).

**Rough commit count.** 4-5.

**Recommended sequencing position.** Sub-phase 4. Could swap with sub-phase 3 (spaced-repetition) if dogfood signal favored; the carving lists 3-then-4 because spaced-repetition is the higher-leverage retention mechanic per PRD §1's short-prep-horizon framing.

**Cross-cutting concerns.** Schema migration: `strategy_views` table if not already present (`(user_id, strategy_id, last_viewed_at_ms)` shape per SPEC §3.4 + §10.3). New `dismissPostSession` server action. SPEC §10.3 (full-length walkthrough) + §6.5 (post-session strategy gate) updates.

## 7. Sub-phase 5 — Click-to-highlight in post-session review

**Title.** Click-to-highlight in post-session explanation review (PRD §6.5 extension).

**Scope.** Render `metadata_json.structuredExplanation`'s parts as clickable elements in the wrong-items browser (built by sub-phase 1). Two interaction modes per the roadmap §3 spec: clicking the `elimination` part strikes through the option ids it referenced via `referencedOptions`; clicking the `tie-breaker` part highlights the option ids it referenced. The `recognition` part typically has empty `referencedOptions` — clicking renders no state change (or shows a small tooltip). State is per-part toggle (clicking again clears the highlight/strike); state is local to the component, not persisted.

**Dependencies.** Sub-phase 1 (the wrong-items browser is the host surface). Phase 2's structured-explanation contract is already shipped on `main` so the data path is intact.

**Rough commit count.** 3-4.

**Recommended sequencing position.** Sub-phase 5. Depends on sub-phase 1; fits naturally after sub-phases 3 and 4 because the surfaces those sub-phases extend (review session, full-length post-session) inherit the click-to-highlight behavior automatically.

**Cross-cutting concerns.** New `<StructuredExplanation>` component that consumes the existing `metadata_json.structuredExplanation` shape. SPEC §6.5 + §3.3.3 reference. No schema changes. PRD update flagged in roadmap (§3 click-to-highlight) lands in this sub-phase's opening commit.

## 8. Sub-phase 6 — Speed-ramp + brutal drill modes + question-timer toggle

**Title.** Speed-ramp + brutal drill modes (PRD §4.4) + question-timer toggle (PRD §5.1).

**Scope.** Wire speed-ramp drill mode (`perQuestionTargetMs: 12_000`, `selectionStrategy: "adaptive"` with `initialTierFor`'s speed-ramp shift-down per SPEC §9.1) and brutal drill mode (`perQuestionTargetMs: 18_000` with brutal-tier override per SPEC §9.1; brutal → hard → end fallback chain with the user-positive end-message per SPEC §9.2). The drill configure page (`/drill/[subTypeId]/page.tsx`) gains a timer-mode selector (standard / speed-ramp / brutal); the run page passes the chosen mode to `startSession`. Question-timer toggle: PRD §5.1's default-OFF state for all session types; user can toggle mid-session; persistence via `users.timer_prefs_json` (already wired per Phase 3).

**Dependencies.** Sub-phase 2 (adaptive walker — speed-ramp + brutal are adaptive variants; without the walker they'd land as constant-tier which defeats their purpose).

**Rough commit count.** 3-4.

**Recommended sequencing position.** Sub-phase 6. Depends on sub-phase 2.

**Cross-cutting concerns.** No schema changes (timer prefs already wired). Focus-shell config additions (per-mode `perQuestionTargetMs`, no internal changes). SPEC §10.2 (drill walkthrough) + §6.7 (question-timer-toggle UX) updates. PRD update flagged in roadmap (§7 dojo mode) is unrelated; this sub-phase doesn't carry that PRD update.

## 9. Sub-phase 7 — NarrowingRamp + Dojo mode UI

**Title.** NarrowingRamp pre-session protocol (PRD §5.3) + Dojo mode UI rename + belt indicator (roadmap #7).

**Scope.** Build the NarrowingRamp 75-second pre-session sequence: obstacle scan (30s prompt → if-then plan stored on session), visual narrowing (15s fixation drill), session brief (15s plain-text preview), countdown launch (15s with periphery dimmed). Optional/skippable per PRD §5.3. Stored if-then plan surfaces during the session via the existing focus-shell triage path. Dojo mode: rename "drill" copy to "dojo" wherever user-facing (not in code-internal session-type values), add `<BeltIndicator>` component that visualizes the adaptive walker's current tier as a martial-arts belt color (white → yellow → green → blue → brown → black mapped to easy / medium / hard / brutal — exact mapping decision deferred to sub-phase plan), and update the post-session summary copy from generic accuracy stats to "you reached [tier] on [sub-type]" framing.

**Dependencies.** Sub-phase 2 (adaptive walker — belt indicator visualizes the walk; without the walker the belt is static and misleading). Independent of sub-phases 1, 3, 4, 5, 6.

**Rough commit count.** 4-5.

**Recommended sequencing position.** Sub-phase 7. Could ship earlier (after sub-phase 2) if dogfood signal favored, but the carving lists it last because it's the largest UX shift and benefits from the rest of Phase 5 being stable first.

**Cross-cutting concerns.** Schema: optional column on `practice_sessions` for the if-then plan (or store in `metadata_json` to avoid a migration; decision deferred to sub-phase plan). New `<NarrowingRamp>` route at `/drill/[subTypeId]/ramp` (or wherever pre-session protocol lives) + `<BeltIndicator>` component. SPEC §5.3 + §10.2 updates. PRD update flagged in roadmap (§7 dojo mode rename + belt indicator) lands in this sub-phase's opening commit.

## 10. Sequencing recommendation

Sub-phase order: **1 → 2 → 3 → 4 → 5 → 6 → 7** as carved above. The critical-path reasoning:

- **1 first** (post-session review surface): three downstream sub-phases (3 spaced-repetition, 4 full-length+gate, 5 click-to-highlight) all build on it. Shipping it first unblocks the most parallelism.
- **2 second** (adaptive walker): two downstream sub-phases (6 speed-ramp/brutal, 7 dojo belt) depend on it. Independent of 1, but landing 1 first lets the adaptive walker's verification check the post-session per-sub-type-latency aggregation as the in-session walker's external observable.
- **3 third** (spaced-repetition): consumer of 1's latency aggregation; high-leverage retention mechanic. Shipping before 4 is the higher-value-first call.
- **4 fourth** (full-length+gate): consumer of 1's review surface. Pairs naturally with 3 (review queue surfaces in Mastery Map alongside full-length CTA).
- **5 fifth** (click-to-highlight): UX polish on top of 1's surface, inherited automatically by 3's review session and 4's full-length post-session.
- **6 sixth** (speed-ramp/brutal/timer-toggle): drill-mode extensions; lower-criticality than full-length and spaced-repetition.
- **7 seventh** (NarrowingRamp + dojo): largest UX shift; benefits from the rest being stable.

Sub-phases 1+2 can run in parallel if a second contributor lands; the carving assumes serial-from-`main` for one contributor.

**Sub-phase 1 entry point: post-session review surface.** Recommended over full-length tests as the entry point because (a) full-length depends on it (the review surface is the destination after a full-length submit minus the strategy gate), (b) the review surface unblocks more downstream sub-phases, (c) it has no Phase 5 dependencies, (d) it's the smallest "load-bearing for downstream" sub-phase in the round. Full-length first would require building a partial post-session surface inside sub-phase 4 that sub-phase 1 then reworks — clear duplication.

## 11. Cross-cutting concerns

Concerns that span multiple sub-phases and benefit from being acknowledged at master-plan time so per-sub-phase plans don't re-derive them:

**Post-session review surface as foundation.** Sub-phase 1's deliverable — a per-session review at `/post-session/[sessionId]` — is the surface sub-phases 3, 4, and 5 all build on. Specifically: sub-phase 3 reads the per-sub-type latency aggregation to decide which items resurface in the review queue; sub-phase 4 layers the 30-second strategy-review gate on top of the review render; sub-phase 5 makes the wrong-items browser's explanation render interactive. Naming and prop shape decisions in sub-phase 1 ripple. The sub-phase 1 plan should call this out and design its prop boundary explicitly.

**Adaptive walker as foundation.** Sub-phase 2's deliverable — `nextDifficultyTier` and the `selectionStrategyForSession("drill", _) === "adaptive"` flip — is what sub-phases 6 and 7 read. Speed-ramp and brutal modes are adaptive variants; the dojo belt indicator visualizes the walk in real time. Sub-phase 2's verification surface (probably a smoke that drives a drill, asserts tier transitions on accuracy/latency thresholds) is what sub-phases 6 and 7 inherit.

**Schema migrations.** Three new tables across the round: `review_queue` (sub-phase 3), `strategy_views` (sub-phase 4 — possibly already on `main` per SPEC §3.4 references; sub-phase 4 audit confirms). Possibly `practice_sessions.if_then_plan` column or `metadata_json` extension (sub-phase 7). Each migration lands at sub-phase opening, atomically with the code that consumes it.

**SPEC sections to update at sub-phase close.** Sub-phase 1: §6.5, §10.x walkthroughs. Sub-phase 2: §9.1 + §9.2. Sub-phase 3: §3.5, §4.3, §9.5. Sub-phase 4: §10.3 + §6.5 strategy gate. Sub-phase 5: §6.5 click-to-highlight. Sub-phase 6: §10.2 drill modes + §6.7 question-timer-toggle. Sub-phase 7: §5.3 NarrowingRamp + §10.2 dojo rename. Each sub-phase's close-out commit handles its SPEC delta; no global SPEC pass at round end.

**PRD updates.** Two sub-phases carry PRD-update commits at their opening (per the roadmap's PRD-update queue): sub-phase 5 (click-to-highlight; PRD §6.5 extension) and sub-phase 7 (dojo rename + belt indicator; PRD §4.2 extension + §5.1 belt-component note). Sub-phases 1, 2, 3, 4, 6 build per existing PRD specs and don't need PRD updates.

**Verification protocol carry-forward.** The `playwright-core` discipline + real-DB harness pattern + smoke-script directory pattern + the SPEC §6.14 implementation notes (especially .14 uniform-response-code, .15 hermetic-smoke isolation, .16 auth-shape audit) all carry forward unchanged. Each sub-phase's verification follows the precedent.

## 12. Out of scope

Explicit list — items deliberately NOT addressed in Phase 5:

- **Phase 4 (LLM generation pipeline).** Its own phase; planned at its own start. Roadmap Round D.
- **Test-day simulation (PRD §4.6).** Phase 6 per `docs/architecture_plan.md` build-sequencing.
- **Admin question portal (#2), stats dashboard (#6), test history (#10), independent timer (#8), CCAT lessons (#9), vocab study guide (#11).** Post-Phase-5 rounds; each has its own roadmap entry.
- **Round Bx (deploy-and-dogfood interlude).** Deferred per Leo's no-deploy-until-feature-complete decision (see §1). Roadmap amendment to mark Round Bx as deferred is a separate follow-up commit.
- **PRD edits.** Per the existing PRD-update-queue convention, those are per-sub-phase commits at sub-phase start. None in this master plan.
- **Per-sub-phase implementation detail.** Each sub-phase's plan is drafted at its own opening, audit-first, against then-current `main` state.
- **Schema design for the new tables.** Sub-phase plans handle their own schema decisions (column shapes, FK behavior, indexes). Master plan only names which tables get added.

## 13. Open questions / resolutions

Two open questions surfaced during master-plan drafting; both need Leo's input before sub-phase 1 can start.

### 13.1 A4 (pre-session readiness check) status

**Question.** A4 was CUT in commit `064a386` on 2026-05-04 with the sub-phase-2-close demotion ("adds friction; defer until evidence users want it") affirmed as durable. Leo's most-recent feature-list paste (the one accompanying the Phase 5 master plan request) re-includes A4 with the metacognitive framing. Two readings:

- *Paste-residue.* The list was assembled before the cut decision and the A4 entry wasn't pruned. A4 stays cut.
- *Re-elevation.* Leo wants A4 back. If so, the resolution from `064a386` is reversed AGAIN, and A4 lands somewhere.

**Resolution: paste-residue read carried forward in the absence of explicit re-elevation. A4 stays cut.** This is the conservative read against the most recent explicit decision. If Leo confirms re-elevation, A4 lives OUTSIDE Phase 5 — it's a NarrowingRamp extension (PRD §5.3 territory, sub-phase 7-adjacent) plus a metacognitive feature (closer to roadmap Round G's framing), not engine-completeness. Re-elevating it would land as a small follow-up round, not a sub-phase amendment to Phase 5.

**Action required from Leo.** Confirm cut stands, OR re-elevate with a stated home (most-likely sub-phase 7 of Phase 5 or its own post-Phase-5 round). Until confirmed, sub-phase plans for Phase 5 proceed without A4 in scope.

### 13.2 Sub-phase 1 entry point

**Question.** Should Phase 5 open with sub-phase 1 (post-session review surface) or sub-phase 4 (full-length tests)?

**Resolution: sub-phase 1 (post-session review surface).** Rationale per §10: full-length depends on the review surface; post-session unblocks three downstream sub-phases; the review surface has no Phase 5 dependencies; full-length-first would build a partial post-session surface inside sub-phase 4 that sub-phase 1 then reworks. Confirming this picks the same answer the master plan's carving assumes; flagging as an open question because reasonable people could prefer "ship the highest-user-value feature first" over "ship the foundation first."

**Action required from Leo.** Confirm sub-phase 1 = post-session review surface, OR redirect to full-length tests.

### 13.3 Round Bx amendment (informational, not blocking)

**Question.** The roadmap's Round Bx (deploy-and-dogfood interlude) is currently named as the next move and described as "gates Phase 5 planning detail." This master plan explicitly skips Round Bx per Leo's no-deploy-until-feature-complete decision. The roadmap needs a one-line amendment to flip Round Bx from "next" to "deferred until Phase 5 + post-Phase-5 rounds complete."

**Resolution.** Deferred — separate follow-up commit, not part of this master plan. Surfaced here so the amendment doesn't get lost.

**Action required from Leo.** Confirm the deferral language is acceptable, or redirect (e.g., remove Round Bx entirely vs. mark as deferred).
