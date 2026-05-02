# 18 Seconds — Architecture Plan

This is the single-document overview of how 18 Seconds is structured. It is the document an engineer reads first, before opening the SPEC. Where the SPEC has file paths and column definitions, this document has component boundaries, data flow, and sequencing. The decisions referenced here are recorded in `docs/design_decisions.md`; the file-level realisation is in `docs/SPEC.md`.

## What we're building

A web app that helps adults pass the Criteria Cognitive Aptitude Test (CCAT). The product distinguishes itself from competitor question-banks by being a **mastery engine**: it tracks per-sub-type performance over 18 sub-types, generates new practice items on demand, and trains the strategic skill of triaging questions at the 18-second mark. The PRD is the product source of truth; this architecture exists to deliver it within a 2-week build window using the Superbuilder superstarter scaffold.

## System decomposition

The application has six logical components, each with a clear responsibility and a narrow API surface to the others.

**1. Auth & gating.** Auth.js v5 + Google OAuth, wired to Drizzle via a thin shim that converts `Date ↔ epoch-ms` so every Auth.js timestamp lands as a `bigint(_ms)` per the codebase convention. Middleware protects every route except `/api/auth/*`, `/login`, `/api/health`, and the cron endpoints. An `(app)/layout.tsx` gate enforces "user has a completed non-abandoned diagnostic" before any practice route renders; if absent, redirect to `/diagnostic`.

**2. Item bank.** PostgreSQL via Drizzle. `items` carries a discriminated `body` JSON (variants: `text`, `text_with_image`, `image_pair`, `image_pair_grid`, `column_matching`, `chart`, `grid`), a uniform `options` array of `{ id, text?, imageUrl? }`, a difficulty tier, and a status (`live`, `candidate`, `retired`). The body discriminator handles every prompt shape we observed in the testbank without coupling to sub-type. Image bytes live in a private S3 bucket and are served through `/api/items/[itemId]/image/[key]` — the route handler auth-checks, validates the key against the item's body-referenced set, signs an S3 URL with 5-minute TTL, fetches, and streams back through Vercel's edge cache (`Cache-Control: private, max-age=86400, immutable`). The `pgvector` extension on `items.embedding` powers the validator's uniqueness check.

**3. Focus shell.** A single React 19 client component, `<FocusShell>`, with a `useReducer`-driven state. It owns every timer-and-dim primitive: session timer bar, pace track, optional per-question timer (off by default, persisted via `users.timer_prefs_json`), persistent triage prompt, inter-question card. Timers run on `requestAnimationFrame` from `performance.now()`, never `setInterval`. The first item is server-rendered into the page response; subsequent items arrive via the `submitAttempt` server action's return value. Latency anchors on a `<ItemSlot>` mount effect that captures `performance.now()` at first paint of every new item, ending at submit. The triage prompt fires once at 18s, stays visible until the user submits or takes it (click or `T` key) — there is **no auto-submit**; the session timer is the only hard cutoff.

**4. Session engine.** Server actions `startSession`, `submitAttempt`, `endSession`, plus `getNextItem`. `getNextItem` dispatches on the session type's `selectionStrategy`: `adaptive` (drills only), `fixed_curve` (diagnostic, full-length, simulation), or `review_queue` (review). Adaptive is computed every call as a pure function over in-session attempts — no in-memory state survives across serverless invocations. Bank-empty fallback chains live here: brutal drills run `brutal → hard → end`; standard drills run the full ladder. Each attempt records `served_at_tier`, `fallback_from_tier` (nullable), and a `fallback_level` metadata field.

**5. Generation pipeline.** A four-stage server module — `generateItem → validateItem → scoreItem → deployItem` — orchestrated as a Vercel Workflow with each stage as a `'use step'` for independent retry. Generator: Claude Sonnet 4 emitting structured JSON matching the per-sub-type Zod template schema. Validator: GPT-4o, returns 1–5 confidence per check (correctness, ambiguity, difficulty, novelty); pass = all four ≥ 4 AND nearest-neighbor cosine similarity < 0.92. Scorer: weighted sum of validator confidences (no per-option distractor scoring — redundant with the ambiguity check). Deployer: writes the item with `status='candidate'`, embedding included. Bank-target management is visible to the admin via a 18 × 4 grid showing live/candidate/target per cell; top-up is one-click.

**6. Mastery & review.** `computeMastery({ source: 'diagnostic' | 'ongoing' })` is a pure function over the user's last-10 attempts on a sub-type, parameterized so the diagnostic derives a meaningful first-day signal (3-attempt threshold, 1.5× latency relaxation, no `mastered` allowed). After every session, `masteryRecomputeWorkflow` recomputes only sub-types touched in that session. The spaced-repetition queue uses an SM-2 ladder (1/3/7/21 days). The strategy library has 3 strategies per sub-type, differentiated by failure-mode kind (recognition / technique / trap). Full-length post-session reviews include a 30-second strategy gate that picks deterministically (lowest accuracy → highest median latency → lexicographic id; least-recently-viewed strategy via `strategy_views`).

## User journey data flow

1. **Sign in.** Google OAuth via Auth.js. `users` row created on first sign-in.
2. **Diagnostic gate.** `(app)/layout.tsx` checks for a completed non-abandoned diagnostic; if none, redirect to `/diagnostic`. The diagnostic is **untimed at the session level** — it measures capacity, not triage. Items are sampled from the hand-tuned 50-row config in `src/config/diagnostic-mix.ts` (no brutal items; numerical over-weighted).
3. **Diagnostic completion.** `endSession` triggers `masteryRecomputeWorkflow` with `source='diagnostic'`. The post-session review captures target percentile and target date inline, then redirects to the Mastery Map.
4. **Mastery Map.** Server-rendered. 18-icon grid (per-section icons, fill state per mastery level), single-line near-goal text, one primary CTA naming the recommended next session, 30-day rolling triage adherence in low-contrast periphery.
5. **Drill or test launch.** A `/drill/[subTypeId]` configure page captures timer mode and length (defaults to last-time for this sub-type). NarrowingRamp follows (skippable). At session start, the recency-excluded item set (last 7 days) is materialized into `practice_sessions.recency_excluded_item_ids: uuid[]`. Server-rendered first item.
6. **Practice loop.** Each `submitAttempt` writes to `attempts`, recomputes adaptive tier (drills) or reads from the fixed curve, returns the next item or `undefined` on completion. The client `sendBeacon`s a heartbeat every 30 seconds plus a `pagehide` "leaving" signal.
7. **Session end.** `endSession` triggers `masteryRecomputeWorkflow` and `reviewQueueRefreshWorkflow`. User lands on `/post-session/[sessionId]`. Full-length tests gate dismissal behind a 30-second strategy review.
8. **Background work.** `/api/cron/abandon-sweep` runs every minute; `/api/cron/candidate-promotion` runs nightly at 04:00 UTC (shadow mode for 30 days, then enforces).

## Deployment topology

Local development uses a `pgvector/pgvector:pg16` Docker container. Production runs on Vercel with AWS RDS via OIDC federation; S3 lives in the same AWS account. LLM access is server-side only — no client SDKs, no streaming. Secrets (`AUTH_GOOGLE_*`, `AUTH_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `S3_*`, `CRON_SECRET`) flow through T3 Env. Production lands as a Vercel **preview deployment first**; promotion to production is a one-click move at launch.

## Major risks and mitigations

**Visual sub-types can't be grown by the pipeline.** Scoped as real-only for v1 with seed targets of 30 items per cell; documented as deliberate scope.

**Vercel serverless drops in-memory state.** Every "session-state-like" thing is derived from the database — adaptive tier recomputed per call, recency-excluded set materialized at session start, abandon detection via heartbeats + cron sweep.

**Candidate items with bad validator calls contaminate the bank.** Candidate-promotion shadow mode for 30 days, wide initial bands, soft-archive `retired` status (recoverable via `UPDATE`), and structured 1–5 validator confidences with full reason logs that make rejections debuggable.

**Latency drift undermines the mastery model.** Server-rendered first item, latency anchored on text paint (not image paint) via the `<ItemSlot>` mount effect, `requestAnimationFrame` for timer ticks.

**LLM spend runs away.** Pino-logged `tokens_in/tokens_out/cost_estimate_usd` per call; admin dashboard compares today's rate against a 7-day same-hour baseline and surfaces a soft warning at 2× baseline. No auto-pause.

**Bank leak.** Private S3 bucket, signed URLs only, route handler validates the requested key against the item's body-referenced set so attackers can't enumerate other keys in the same path.

## Build sequencing

**Phase 1 — Foundations (week 1, days 1–3).** Auth + Drizzle adapter shim + complete schema (auth, catalog, practice, review, plus `candidate_promotion_log`, `strategy_views`, `mastery_state.was_mastered`, all `bigint(_ms)`-shaped). pgvector extension. S3 bucket. Configuration files.

**Phase 2 — Real-item path (week 1, days 3–5).** Admin ingest form + tagger LLM call + image upload to S3. Hand-seed ~150 real items (40–50 per visual sub-type per the v1 target). Embedding-backfill workflow. Validates the body discriminator end-to-end.

**Phase 3 — Practice surface (week 1, days 5–7).** Focus shell + diagnostic flow + Mastery Map + standard drill mode + heartbeats + abandon-sweep cron. Onboarding capture at end of post-diagnostic. The whole user-facing happy path runs end-to-end against real items.

**Phase 4 — Generation pipeline (week 2, days 1–3).** Generator + validator + scorer + deployer + workflow + admin generation page. Vercel + RDS + S3 wired. First end-to-end candidate items land. Cost telemetry surfaces.

**Phase 5 — Engine completeness (week 2, days 3–5).** Adaptive difficulty (drills) + spaced-repetition queue + review session + speed-ramp/brutal modes + question-timer toggle + NarrowingRamp + strategy review gate.

**Phase 6 — Polish & cuts (week 2, days 5–7).** Test-day simulation + history tab + candidate-promotion cron in shadow mode. PRD §9 cuts apply if behind: simulation, history detail views, NarrowingRamp's visual-narrowing step. The mastery model, generation pipeline, focus shell, and Mastery Map are non-negotiable.
