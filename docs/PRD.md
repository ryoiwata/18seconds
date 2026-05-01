# 18 Seconds — Product Requirements Document

A self-service web application for adults preparing for the Criteria Cognitive Aptitude Test (CCAT). Users practice over 1–4 week prep cycles, building speed and accuracy across the 15 question sub-types that compose the test.

The CCAT is 50 multiple-choice questions in 15 minutes (~18 seconds per question), spanning verbal, math/logic, and spatial reasoning. No calculator. Score is raw correct out of 50; average is 24/50.

---

## 1. Product Summary

### Goals

Existing CCAT prep tools are question banks with timers. 18 Seconds is a mastery engine: it tracks user performance per sub-type, generates new practice items on demand, surfaces the user's specific weaknesses, and trains the strategic skills that distinguish high CCAT scorers (notably, knowing when to abandon a question).

### Non-goals

- General aptitude prep beyond the CCAT (no Wonderlic, no UCAT, no SAT).
- Mobile-native apps. Web only, responsive design.
- Multi-user features (leaderboards, social, cohorts, sharing).
- Live tutoring, chat with an AI, or any direct LLM-to-user interaction.
- Payments, accounts beyond auth, marketing pages.

### Users

Adults preparing for the CCAT as part of a hiring screen. Self-motivated, short prep horizons (days to weeks), already capable. The app assumes the user knows what the CCAT is and why they're studying.

---

## 2. Domain Model

### Sub-types

The CCAT decomposes into ~15 sub-types across three sections. The system treats each sub-type as an independent skill with its own mastery state, item bank, and latency threshold.

**Verbal:**

- Antonyms
- Synonyms
- Analogies
- Sentence completion
- Verbal logic / syllogisms

**Math / Logic:**

- Arithmetic word problems
- Number series
- Ratios and percentages
- Algebra word problems
- Numerical logic

**Spatial:**

- Next in series
- Matrix completion
- Outlier identification

The exact sub-type list is configurable via a single source-of-truth config file. Initial implementation should support adding a new sub-type by adding a config entry plus an item template — no other code changes.

### Items

Every practice question (an "item") has:

- A unique ID
- A sub-type
- A difficulty tier: `easy` | `medium` | `hard` | `brutal`
- A source: `real` | `generated`
- A prompt (text or image reference)
- Answer options (typically 4–5)
- The correct answer
- An optional explanation
- An optional strategy hint (referenced by ID; see Strategy Library)
- Generation metadata (if generated): template ID, generator model, validator outcome, quality score

### Mastery state

Each user has a per-sub-type mastery state, computed from their last N attempts on that sub-type:

- **Learning** — accuracy below 70%.
- **Fluent** — accuracy ≥ 80% but median latency above the sub-type's threshold.
- **Mastered** — accuracy ≥ 80% AND median latency ≤ threshold.
- **Decayed** — was mastered, but recent attempts have dropped below the threshold; queued for review.

Latency thresholds are per sub-type, set tighter than 18 seconds. The threshold values live in the same config file as the sub-type list.

### Sessions

A session is a contiguous block of practice. Three session types:

1. **Diagnostic** — 50-question calibration, runs once on first use.
2. **Drill** — single-sub-type, configurable length and timer mode.
3. **Full-length test** — 50 questions across all sub-types, real-test pace.

### Attempts

Every answered question produces an attempt record:

- Item ID
- User ID
- Session ID
- Selected answer (or null if skipped/timed out)
- Correct (boolean)
- Latency (ms from question render to answer submit)

---

## 3. Item Bank

### 3.1 Real-item ingest

The seed bank is built from screenshots of actual CCAT items. The ingest flow is:

1. A simple internal admin page accepts uploaded screenshots.
2. The user (admin) types in or pastes the question text, options, correct answer, and explanation. (No OCR required for v1; manual entry is fine.)
3. The LLM tags the sub-type and difficulty tier.
4. The item is saved with `source: real`.

This admin page is not exposed to end users. It does not need polish — a single form per item is sufficient.

### 3.2 LLM item generation pipeline

A server-side pipeline generates new items from templates. The pipeline is the centerpiece of the application's architecture and must be clearly structured.

**Pipeline stages:**

1. **Template selection.** Each sub-type has one or more templates stored in the codebase as structured prompts (e.g., "Generate a CCAT antonym question. Provide a target word, 5 options, and the correct answer. The correct option should be the clearest opposite. Difficulty: {tier}.").
    
2. **Generation.** Call an LLM (Anthropic Claude or OpenAI GPT-4) with the template and target difficulty. Request a structured response (JSON) containing prompt, options, correct answer, explanation.
    
3. **Validation.** Call a second LLM with the generated item and a validator prompt. The validator checks: (a) is the answer actually correct, (b) is the question unambiguous, (c) does it match the difficulty tier, (d) is it materially different from N existing items in the same sub-type (uniqueness check via embedding similarity).
    
4. **Quality scoring.** Compute a difficulty estimate from item characteristics (option count, prompt length, semantic distance between distractors). Store as metadata.
    
5. **Candidate deployment.** The item enters the bank with `source: generated, status: candidate`. It can be served to users.

**Hard rule:** The LLM is never exposed to the end user. No chat, no tutor, no user-facing AI generation. The pipeline runs server-side and produces structured items rendered through the same UI as real items.

### 3.3 Bank separation

Two banks are tracked:

- **Real items** — small (~150 items at launch), high trust. Used for the diagnostic and the test-day simulation.
- **Generated items** — large (grows over time), used for daily drill, spaced-repetition review, and adaptive sessions.

The user is never told which bank an item came from. The system tracks the source for quality monitoring.

---

## 4. Engine

### 4.1 Diagnostic onboarding

First time a user opens the app, they take a 50-question calibration test before anything else. No tutorial, no settings, no profile setup beyond auth.

The diagnostic samples items proportionally across the 15 sub-types and across difficulty tiers. It runs in the same focus-mode shell as regular practice (see section 5).

Output: a per-sub-type mastery estimate computed from the diagnostic attempts. The user lands on the Mastery Map (section 5.2) with mastery icons populated and a recommended first session queued up.

### 4.2 Adaptive difficulty

Within a sub-type, the engine selects the next item to keep the user in the 80–85% accuracy zone. Implementation:

- Track running accuracy and latency over the last 10 attempts in the current sub-type within the current session.
- If accuracy ≥ 90% AND latency comfortably under threshold → step up one difficulty tier.
- If accuracy ≤ 60% OR latency well above threshold → step down one tier.
- Otherwise hold.

The engine never serves the same item twice in a session. Across sessions, items can repeat per the spaced-repetition rules.

### 4.3 Spaced-repetition review queue

Items the user got wrong (or got right but slowly, missing the mastery latency) enter a review queue. Items resurface at intervals: 1 day, 3 days, 7 days, 21 days. Use a simple SM-2 style schedule.

A "review" session pulls only items currently due. Available from the Mastery Map as a single button when due items exist.

### 4.4 Drill modes

Per-sub-type drills support three timer modes:

- **Standard:** 18 seconds per question, default difficulty mix.
- **Speed ramp:** 12 seconds per question, easier difficulty mix.
- **Brutal:** 18 seconds per question, hard items only.

Drill length is configurable (default 10 questions). The drill runs through all questions, then surfaces the post-session review (section 6.4).

### 4.5 Full-length practice test

50 questions in 15 minutes, real-test difficulty mix and section ordering. Pulls from the real-items bank when possible. Exits to the post-session review on completion or timeout.

### 4.6 Test-day simulation mode

Identical to the full-length practice test but with stricter UI: no pause button, no visible question-skip indicators, exact section ordering matching the real Criteria On-Demand Assessment platform. Used as a final dress rehearsal before a real test. Available from the Mastery Map but not the default session option.

---

## 5. Interface

#### 5.1 The focus-mode shell

Every practice session — diagnostic, drill, full-length test, and simulation — runs inside a shell with strict UI rules.

**During a question:**

- The current question is the only fully-illuminated element. Periphery is dimmed (~20% brightness).
- No visible progress count (no "12 of 50" or percentage).
- No navigation chrome, sidebars, or notifications.
- Single salient target: the question and its answer options.

**Timers:**

- **Session timer (overall).** A countdown for the full session length (e.g., 15:00 for a full-length test, 3:00 for a 10-question speed drill), rendered as a horizontal bar spanning the periphery. The bar starts full at the start of the session and depletes from the left edge toward the right as time elapses, so the remaining-time portion shrinks toward the right edge of the screen. A small numeric readout (e.g., `8:42`) sits at the right end of the bar for users who want exact remaining time. Default state per session type: ON for full-length tests, simulations, drills, and the diagnostic.
- **Pace track (overall).** A second horizontal bar rendered immediately above below the session timer bar, divided into discrete blocks — one block per question in the session (e.g., 50 blocks for a full-length test, 10 for a 10-question drill). Each block is sized to represent the per-question pace target, so the total length of the pace track matches the total length of the session timer when the user is exactly on pace. For most sessions, each block represents 18 seconds of session time; for speed-ramp drills, each block represents the tighter target (e.g., 12 seconds). The block size is configured per session type and per drill mode. When the user submits an answer, the leftmost block in the pace track is removed (the track shortens from the left edge inward). The visual relationship between the pace track and the session timer bar tells the user, at a glance:
    - **Pace track shorter than session timer remaining** → user is ahead of pace. They have surplus time.
    - **Pace track longer than session timer remaining** → user is behind pace. They are spending more than the per-question target on average.
    - **Pace track equal to session timer remaining** → user is exactly on pace.Both bars share the same visual register (same height, same color treatment, same dimming). The pace track is non-interactive — it is purely a visualization of the question-budget remaining versus the time-budget remaining.
- **Question timer (per-question).** An 18-second countdown for the current question (or the per-question target for the active drill mode, if different), rendered as a horizontal bar that depletes from the left edge toward the right, so the remaining-time portion shrinks toward the right edge of the screen. The bar starts full when the question renders and reaches zero at the per-question target. When it reaches zero, the triage prompt fires. Default state: OFF for all session types unless the user enables it. The user can toggle it mid-session without ending the question.

All three visual elements — session timer bar, pace track, and question timer bar — sit in the periphery, dimmed to match the surrounding chrome. They never overlap the question content. When any of them is toggled OFF, its visual element is fully hidden (not greyed out). The shell tracks elapsed time internally regardless of display state.

**Triage prompt (see section 6.1):**

- When a question's elapsed time exceeds 18 seconds, the periphery flashes a single message: "Best move: guess and advance." This is the only mid-question UI element that appears regardless of timer settings.

**Implementation note:** Build the shell as a reusable component (e.g., `<FocusShell>{children}</FocusShell>`). All session types render through it. The shell owns the dimming, both timers, the triage prompt, the timer toggle controls, and the inter-question card. Timer visibility state should be persisted per user (so if a user turns the question timer on during one drill, it stays on for their next drill until they toggle it off).

### 5.2 Mastery Map (home screen)

The default screen on app open (after auth and post-diagnostic). Contents:

- **Today's near goal.** One categorical target rendered as a single line of text. Examples: "Master Next in Series by Friday — 2 sessions to go." or "Finish today's drill — 1 session left." Computed from current mastery state plus user's target date (section 6.3).
- **Sub-type mastery icons.** 15 icons in a grid. Each icon shows mastery state via fill: `mastered` (filled), `fluent` (half-filled), `learning` (outlined), `not yet attempted` (locked). No percentages, no numbers, no scores beneath the icons.
- **Start session button.** Single primary CTA labeled with the next recommended session ("Start drill: Next in Series"). One button. No menu of options.
- **Secondary actions.** Small, low-contrast: "Review (3 due)" if review items exist, "Full-length test," "Test-day simulation," "History."

What's NOT on this screen: percentage progress, calendar view, multi-week roadmap, achievements, motivational messages, anything decorative.

### 5.3 NarrowingRamp (pre-session protocol)

An optional 75-second protocol that runs before any drill, full-length test, or simulation. The user can skip it via a small link, but it's the default flow. Not used before the diagnostic.

**Sequence:**

1. **Obstacle scan (30s).** A prompt: "What's most likely to cost you points today?" Three suggested options surface based on the user's current weakest sub-types and recent failure patterns. User picks one. An if-then plan is suggested via LLM or preset (e.g., "If I've spent 18 seconds on a question, I will guess and advance"). User can accept the suggestion or write their own. The plan is stored on the session.
    
2. **Visual narrowing (15s).** A central fixation point appears. Periphery dims fully. A small target moves slowly across the screen; the user follows it with their eyes. No interaction required. Ends with a brief pulse on the central point.
    
3. **Session brief (15s).** A categorical preview, plain text: "Today's session: Next in Series drill. 10 questions. 12 seconds each." No success language. No "you've got this." No imagery.
    
4. **Launch (15s).** A 5-second countdown with the periphery already dimmed. The first question appears.
    

Mid-session, if the user's stored if-then plan's trigger fires (e.g., they cross 18 seconds on a question and the plan was about triage), the periphery flashes their own committed response back at them rather than the generic triage prompt.

### 5.4 History tab

A simple chronological list of past sessions. Each row: date, session type, sub-type(s) covered, accuracy, median latency. Click into a row to see the per-question breakdown. Available from a small link on the Mastery Map. Not on the default screen.

---

## 6. Speed-Test-Specific Features

### 6.1 Triage trainer

When the timer for the current question crosses 18 seconds, the focus shell flashes a single message in the periphery: "Best move: guess and advance." If the user clicks it (or presses a configured shortcut), they advance with whatever option is currently selected (or a random one if none).

Each triage event is logged on the attempt:

- Prompt fired: yes/no
- User took the prompt: yes/no
- Question outcome: correct, incorrect, skipped

The user's **triage score** = % of questions where the prompt fired AND the user took it. Surfaced in post-session review and on the Mastery Map (small, secondary).

### 6.2 Speed ramp drill mode

Already specified in section 4.4. Tighter timer (12s vs 18s) on easier items. The intent is to train above the target tempo so target tempo feels manageable.

### 6.4 Strategy library

A small library of plain-text strategy notes, one or more per sub-type. Stored in the codebase (generated based on example problems and reference material). Examples:

- Number series: "Test differences between consecutive terms before testing ratios."
- Antonyms: "When two answers seem opposite, the correct answer is usually the more general opposite."

Strategies surface in two places, both _outside_ an active question:

1. After a session, in the post-session review (section 6.5), paired with sub-types where the user struggled.
2. From the Mastery Map history tab, browsable by sub-type.

Strategies never appear during an active question.

### 6.5 Post-session review

After every session (drill, full-length test, simulation, diagnostic), the user lands on a review screen. Contents:

- Accuracy summary by sub-type (categorical: ✓ / ✗ counts, no percentages on this screen).
- Median latency by sub-type, with the threshold marked.
- Triage score for the session.
- Any wrong items, browsable. Each shows the prompt, options, correct answer, explanation.
- Surfaced strategies for sub-types where the user struggled.

After a full-length practice test only, an additional 30-second strategy-review prompt runs before the user can dismiss the screen. The system picks one strategy (paired with the question type the user struggled most with in the test) and displays it. The user must view it before "completing" the test in the system.

Drills and the diagnostic skip the 30-second strategy-review gate; their post-session review is dismissible immediately.

---

## 7. Tech Stack

The stack is anchored on the Superbuilders [`superstarter`](https://github.com/superbuilders/superstarter) Next.js template. The rationale is twofold: it ships with the conventions and tooling Alpha's engineering team uses internally (so anyone reviewing the code recognizes the patterns immediately), and it eliminates a half-day of toolchain setup so the build can focus on the application itself.

### Foundation (inherited from superstarter)

- **Framework:** Next.js (App Router) with React 19. Server components for data fetching; client components for the focus shell, timers, and admin forms.
- **Runtime & package manager:** Bun.
- **Database:** PostgreSQL via Drizzle ORM. AWS RDS in production with IAM auth via OIDC federation (no DB passwords in env). Local development uses a Docker-hosted Postgres pointed at via `DATABASE_URL`.
- **Hosting:** Vercel, with Vercel ↔ AWS OIDC federation pre-configured by the IaC package (`packages/superstarter-iac`).
- **Linting & formatting:** Biome with the custom GritQL ruleset (the "Superbuilder Ruleset"). Enforced via Lefthook pre-commit hook.
- **Error handling:** [`@superbuilders/errors`](https://github.com/superbuilders/errors) — the Go-inspired explicit-error-return pattern. `try/catch` and `new Error()` are banned by the ruleset.
- **Logging:** Pino via the `@/logger` wrapper provided by superstarter. Structured key-value attributes only; no string interpolation.
- **Environment variables:** T3 Env for typed, validated environment access.
- **TypeScript:** TypeScript 7 beta via `tsgo`. Falls back to `@typescript/typescript6` aliased as `typescript` for packages that require the legacy peer.

### Authentication

- **Auth.js v5** (`next-auth@beta`) with the Drizzle adapter (`@auth/drizzle-adapter`).
- **Provider:** Google OAuth only. No email/password, no other providers.
- **Setup:** Google OAuth client created in Google Cloud Console (Web application type), with localhost and production callback URLs registered. Three env vars: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`.
- **Schema customization:** Auth.js's default schema uses `timestamp` columns. The Superbuilder Ruleset bans these, so the Drizzle adapter is configured with a custom schema that uses `bigint` (epoch milliseconds) for `expires`, `email_verified`, etc.

### LLM integration (server-side only)

- **Generator:** `@anthropic-ai/sdk` calling Claude Sonnet 4. Stronger at structured creative output for the item templates.
- **Validator:** `openai` SDK calling GPT-4o. Different model from the generator to reduce shared-bias errors per the Generation Pipeline spec (section 3.2).
- **Embeddings:** OpenAI `text-embedding-3-small` for the validator's uniqueness check. Cheap, fast, sufficient for the in-bank-similarity comparison.
- **Hard rule:** All LLM calls happen in server-side modules. No client-side SDK usage. No streaming responses to the user. No chat surface.

### Vector search

- **`pgvector`** as a Postgres extension for storing and querying item embeddings. Added to the IaC config alongside `pgcrypto`.
- **Schema:** one `embedding vector(1536)` column on the `items` table.
- **Query pattern:** cosine similarity, fetched via Drizzle using a custom column type for `vector`.

### Async work

- **Vercel Workflows** (`"use workflow"` / `"use step"` directives, already wired up by superstarter).
- **Workflow uses:**
    - The generation pipeline (generate → validate → score → deploy), one workflow per item with retries.
    - Recomputing user mastery state after a session.
    - Refreshing the spaced-repetition queue.
    - Backfilling embeddings for newly-ingested real items.
- **Synchronous path** (not workflows): every user-facing interaction. Question render → answer submit → next question stays a single round trip.

### Frontend

- **Styling:** Tailwind CSS 4 via shadcn/ui (already installed at `src/components/ui/` in superstarter).
- **Animations:** Framer Motion for the focus shell's dimming transitions, inter-question card fades, the visual narrowing protocol, and the timer bar depletion.
- **Optimistic updates:** React 19's `useOptimistic` hook for answer submission. Optimistically advance the UI; persist the attempt asynchronously.
- **Icons:** Lucide React for the Mastery Map's mastery-state icons.
- **Design system (optional):** The [`alpha-style`](https://github.com/PSkinnerTech/alpha-style) skill bundle, installed into the AI coding tool (`npx skills add PSkinnerTech/alpha-style`). Applied selectively: invoked for the Mastery Map, post-session review, history tab, and admin pages; explicitly opted out of inside the focus shell, which deliberately departs from Alpha's polished aesthetic per SPOV 4.

### Focus shell implementation specifics

The focus shell is the load-bearing UI primitive and warrants explicit choices:

- Single component (`<FocusShell>{children}</FocusShell>`) with internal state for timer visibility, dim level, current item, and elapsed time. Not fragmented across multiple components — visual coherence depends on shared state.
- **Layout:** CSS Grid with named template areas (`header` for timer bars and pace track, `content` for the salient question, `footer` for the question timer when enabled, `peripheral` for the triage prompt overlay). Dimming is animated by tweening `opacity` on each named area independently.
- **Timer animations:** `requestAnimationFrame` (not `setInterval`). Smoother depletion, easier pause/resume, no clock drift.
- **Latency measurement:** the `Performance` API (`performance.now()`). Sub-millisecond precision. Latency starts at first paint of the question, ends at submit click — exactly what the spec requires.

### What's intentionally not in the stack

For clarity on what won't be installed and why:

- **No tRPC.** Server actions cover all client-server communication.
- **No global state library** (Redux, Zustand, Jotai). Server state is in Postgres; client state is component-local. The focus shell's complexity is manageable with `useReducer`.
- **No client-side query library** (TanStack Query, SWR). Server components handle fetching.
- **No Redis.** Postgres is sufficient for the spaced-repetition queue and session state at this scale.
- **No payments, email service, analytics SDK, notification system, or CDN configuration.** Out of scope per section 9.

### Required external accounts and credentials

- **AWS account** with credentials in `~/.aws/credentials` and a default VPC in `us-east-1` (for production IaC).
- **Vercel team** (not just a personal account — OIDC federation requires a team slug).
- **Google Cloud Console project** for the OAuth client.
- **Anthropic API key** with billing enabled (~$50 credit recommended for development).
- **OpenAI API key** with billing enabled (~$50 credit recommended; the validator chain runs the bill faster than the generator alone).

### Local development fallback

If AWS or Vercel team accounts aren't yet provisioned, the application can run locally without the production IaC. Use a Docker-hosted Postgres pointed at via `DATABASE_URL` instead of the IAM-auth pool. The application code is identical; only the database connection module differs. Production deployment requires the full IaC.
### Data model (initial sketch)

```
users (id, email, password_hash, target_percentile, target_date, created_at)
sub_types (id, name, section, latency_threshold_ms)
items (id, sub_type_id, difficulty, source, status, prompt, options_json,
       correct_answer, explanation, strategy_id, metadata_json, created_at)
sessions (id, user_id, type, started_at, ended_at, narrowing_ramp_completed,
          if_then_plan)
attempts (id, session_id, item_id, selected_answer, correct, latency_ms,
          triage_prompt_fired, triage_taken, created_at)
mastery_state (user_id, sub_type_id, current_state, updated_at)
review_queue (id, user_id, item_id, due_at, interval_days)
strategies (id, sub_type_id, text)
```

### Generation pipeline

The pipeline lives behind an internal API (`POST /admin/generate-items`). Triggered manually for v1 (admin runs it to top up the bank). Output: candidate items written to the database.

The pipeline should be a single file or small module with the four stages clearly separated:

- `generateItem(template, difficulty)` → raw item from generator LLM
- `validateItem(item, existingBank)` → pass/fail with reasons
- `scoreItem(item)` → quality + difficulty estimate
- `deployItem(item)` → write to DB as candidate

This structure is itself a deliverable. The README must walk through it explicitly.

### Performance
- Latency measurement starts at first paint of the question, ends at submit click.
- Generation pipeline runs async; users never wait on it.

---

## 8. Build Order

A 2-week build plan, in priority order.

**Week 1:**

1. Auth + database schema + sub-type config.
2. Real-item ingest admin page; seed ~150 items by hand.
3. Focus shell component + diagnostic flow.
4. Mastery state computation + Mastery Map screen.
5. Drill mode (standard timer only).

**Week 2:**

6. LLM generation pipeline (generator + validator + scorer + deploy).
7. Adaptive difficulty + spaced-repetition queue.
8. Triage trainer + speed ramp + brutal drill modes.
9. NarrowingRamp + score-to-target + post-session review.
10. Strategy library + test-day simulation mode + history tab.

**Cuts if behind:** test-day simulation, history tab detail views, NarrowingRamp's visual narrowing step (keep the obstacle scan and brief). The mastery model, generation pipeline, focus shell, and Mastery Map are non-negotiable.

---

## 9. Out of Scope (for v1)

- Mobile apps.
- Multi-language support.
- Account recovery flows beyond a basic password reset.
- Analytics dashboards beyond what's on the Mastery Map and history tab.
- Item difficulty tuning via crowdsourced data (manual difficulty tagging is sufficient).
- A/B testing infrastructure for UI variants.
- Notification systems (email, push, SMS).
- Payments or subscriptions.
- Any social or sharing features.
- Offline mode.

# CCAT Question Categories

Reference document describing the CCAT (Criteria Cognitive Aptitude Test) question taxonomy. The CCAT is 50 questions in 15 minutes, with no calculator allowed and no ability to revisit prior questions. Question difficulty increases as the test progresses.

The test does not separate questions by category — verbal, numerical, and abstract questions are interleaved randomly. The mix is roughly even across the three categories, with each accounting for 30–35% of the test.

The CCAT does not assess advanced knowledge. It assesses pattern recognition speed under time pressure. Average per-question budget is ~18 seconds.

---

## Categories at a Glance

|Category|Approximate share|What it measures|
|---|---|---|
|Verbal reasoning|30–35%|Vocabulary, word relationships, logical inference from text|
|Numerical reasoning|30–35%|Mental arithmetic, pattern recognition in numbers, word-to-math translation|
|Abstract reasoning|30–35%|Visual pattern recognition without words or numbers|

---

## 1. Verbal Reasoning

Tests vocabulary recognition, logical reasoning expressed in words, and reading comprehension under time pressure. Verbal questions are typically the fastest to answer when the test-taker recognizes the answer immediately, and the easiest to abandon when they don't — partial credit from elimination is rarely productive.

### 1.1 Synonyms

Choose the word closest in meaning to a target word.

**Example:** _Audacious_ → **Bold**

The test-taker either knows the vocabulary or they don't; mid-question deliberation is usually unproductive. Recognition speed is the dominant skill.

### 1.2 Antonyms

Choose the word opposite in meaning to a target word.

**Example:** _Scarce_ → **Abundant**

Same recognition-speed dynamic as synonyms. A common trap: when two answer options seem opposite to the target, the correct answer is usually the more _general_ opposite.

### 1.3 Analogies

Identify the relationship between a pair of words and select another pair with the same relationship.

**Example:** _Bird : Fly :: Fish : Swim_

The trick is naming the relationship in plain language ("a bird's primary mode of locomotion is flight") before scanning options. Without an articulated relationship, similar-looking distractors mislead.

### 1.4 Sentence Completion

Fill in one or more blanks in a sentence such that the result is logically and grammatically coherent.

**Example:** _Although he was warned, he continued to ___ the rules._

Context cues — especially conjunctions like "although," "because," "despite" — usually telegraph whether the missing word should agree or contrast with the surrounding text.

### 1.5 Logical Statements (Syllogisms)

Given one or more premises, decide whether a conclusion is **True**, **False**, or **Uncertain** based only on the stated information.

**Example:**

- Premise: _All engineers are logical._
- Statement: _Some logical people are engineers._ → **Uncertain**

The most common trap is relying on real-world knowledge instead of strictly the given premises. The premises define a closed world; nothing outside them counts.

### 1.6 Critical Reasoning

Read a short passage and identify the valid conclusion, the best inference, or a logical flaw.

Often involves distinguishing between what the passage _states_, what it _implies_, and what would require _additional information_. The correct answer is typically the most modest claim consistent with the passage — strong-sounding claims are usually overreaches.

---

## 2. Numerical Reasoning

Tests mental arithmetic, recognition of numerical patterns, and the ability to translate verbal problems into math. No calculator is permitted. The math itself is rarely complex; the difficulty comes from speed and from recognizing the simplest possible solution path.

This is the category where most test-takers lose the most time. Recognizing the simplest applicable rule before computing is the dominant skill.

### 2.1 Number Series

Identify the next number in a sequence based on an underlying pattern.

Common patterns:

- Addition or subtraction with a constant difference
- Multiplication or division with a constant ratio
- Alternating rules (e.g., +2, ×2, +2, ×2)
- Second-order patterns (differences of differences)
- Interleaved sequences (two sequences alternating)

The fastest approach is testing differences between consecutive terms first, then ratios, then second-order patterns. Most series resolve at the first level.

### 2.2 Arithmetic Word Problems

Short real-world problems requiring translation into a calculation.

Common topics:

- Ratios and proportions
- Percentages
- Speed, distance, and time
- Work and rate problems
- Cost, price, and discount problems

The bottleneck is usually the translation, not the arithmetic. Sketching the relationship before computing is faster than attempting to compute directly from the text.

### 2.3 Fractions

Compare fractions, find the largest or smallest in a set, or convert between forms.

The test rewards techniques that avoid full computation: cross-multiplication for comparisons, recognizing common reference points (½, ¼, ⅓), and identifying when a fraction is obviously larger or smaller than another without exact calculation.

### 2.4 Percentages

Compute percentage increases, decreases, percent-of relationships, and relative comparisons.

A frequent trap: "increased by 50% then decreased by 50%" does not return to the starting value. Anchoring on the base after each step prevents this error.

### 2.5 Basic Algebra

Solve for an unknown in a simple equation.

The equations are intentionally light — usually one or two steps. The challenge is setting up the equation correctly from a word problem rather than the algebraic manipulation itself.

### 2.6 Averages and Ratios

Compute means, weighted averages, and proportional relationships.

For averages, the sum-over-count formula is sufficient for almost all questions. For ratios, recognizing whether a problem is asking about parts-to-parts or parts-to-whole is the most common point of error.

---

## 3. Abstract (Non-Verbal) Reasoning

Tests visual pattern recognition, spatial logic, and reasoning without language or numbers. Abstract questions vary widely in difficulty — some resolve at a glance, others require systematic elimination. Recognizing which is which quickly is the dominant strategic skill in this category.

### 3.1 Odd One Out

Identify the shape that does not follow the same rule as the others.

The fastest approach is identifying a shared property across most options (e.g., "all are rotationally symmetric except one"), not exhaustively comparing every option to every other.

### 3.2 Shape Series

Determine the next shape in a visual sequence.

Common transformations:

- Rotation (typically 90° or 180° increments)
- Reflection across an axis
- Translation (movement of an element across positions)
- Count changes (additions or removals of elements)
- Shading or color changes
- Size or scale changes

Series often combine two transformations (e.g., rotation and a count change). Identifying one transformation and then checking if a second is also at work is faster than searching for the combined rule directly.

### 3.3 Matrix (Grid) Problems

A grid — typically 3×3 — with one cell missing. Identify the shape that completes the grid based on patterns across rows, columns, or diagonals.

Patterns may apply:

- Across rows (left-to-right transformations)
- Down columns (top-to-bottom transformations)
- Along diagonals
- Across the entire grid as a single composition

Matrix problems are the most likely category to consume the test-taker's time and are the strongest candidates for triage. If a pattern doesn't surface within the first few seconds, abandoning and guessing is usually the right call.

### 3.4 Shape Transformations

Identify how a shape has been transformed between two states, or apply a stated transformation to predict a new state.

Transformations include:

- Rotation
- Reflection / flipping
- Addition or removal of elements
- Changes to shading or fill
- Compound transformations (e.g., rotate then reflect)

Eliminating answers that violate one obvious property of the transformation (e.g., chirality preserved or not preserved) usually narrows the choices to two before any detailed analysis.

---

## Test Format Notes

- The test is **not divided into sections**. Verbal, numerical, and abstract questions appear in random order.
- The test-taker **cannot revisit** prior questions. Once an answer is submitted (or a question is skipped), it is final.
- There is **no penalty for wrong answers**. Guessing on a question the test-taker cannot solve is strictly better than skipping it.
- Difficulty **increases as the test progresses**. The first 10 questions are noticeably easier than the last 10.
- **Less than 1% of test-takers complete all 50 questions.** A score of 31/50 typically lands above the 80th percentile; 40/50 lands in the top percentile.

---

## Strategic Implications

The CCAT rewards triage discipline more than per-question speed. The test-takers who score highest are not those who answer every question faster — they are those who recognize unsolvable-in-18-seconds questions early and abandon them with a guess.

Highest-leverage skills:

- Fast recognition on synonyms, antonyms, and simple number series.
- Fluent fraction and percentage comparison without full calculation.
- Quick triage of complex matrix problems and wordy arithmetic problems.

Lowest-leverage skills (despite being intuitive places to invest prep time):

- Working through long arithmetic problems carefully.
- Exhaustive elimination on hard matrix problems.
- Re-reading verbal questions to confirm a vocabulary guess.

---

## Sub-Type Inventory (for system reference)

The 15 sub-types implemented in the practice system map to the categories above:

**Verbal (5):**

- `verbal.synonyms`
- `verbal.antonyms`
- `verbal.analogies`
- `verbal.sentence_completion`
- `verbal.logic` (combines syllogisms and critical reasoning)

**Numerical (5):**

- `numerical.number_series`
- `numerical.word_problems` (combines arithmetic word problems and basic algebra)
- `numerical.fractions`
- `numerical.percentages`
- `numerical.averages_ratios`

**Abstract (5):**

- `abstract.odd_one_out`
- `abstract.shape_series`
- `abstract.matrix`
- `abstract.transformations`

Each sub-type has its own item template, latency threshold, and strategy library entry.