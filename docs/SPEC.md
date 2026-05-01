# 18 Seconds — Engineering Specification

This document is the engineering plan for building 18 Seconds on top of the Superbuilder superstarter scaffold currently checked into this repository. It translates `docs/PRD.md` into concrete file paths, schemas, server actions, and component boundaries that respect the conventions enforced in `rules/` and `gritql/`. Every claim cites either the PRD, a rule file, a `.grit` file, or an existing source file in this repo.

---

## 1. Overview

18 Seconds is a self-service web application for adults preparing for the Criteria Cognitive Aptitude Test (CCAT). It tracks per-sub-type mastery, generates practice items via an LLM pipeline, and trains the strategic skill of abandoning questions at the 18-second mark (PRD §1, §2, §6.1).

Architectural shape:

- **Next.js App Router** with React 19 (PRD §7, `src/app/page.tsx`, `src/app/layout.tsx`).
- **Server components for data fetching**, with the `prepare(...)` + `Awaited<ReturnType<typeof query.execute>>[number]` pattern visible in `src/app/page.tsx:7-17` and required by `rules/rsc-data-fetching-patterns.md`.
- **Server actions for mutations**, with `revalidatePath` after writes (`src/app/actions.ts`).
- **Vercel Workflows** (`"use workflow"` / `"use step"`) for asynchronous, retriable work — see `src/workflows/example.ts` for the existing shape and PRD §7 ("Async work") for the four planned uses.
- **A single `<FocusShell>` client component** (PRD §5.1) that owns timers, dimming, the triage prompt, and the inter-question card. Every session type — diagnostic, drill, full-length test, simulation — renders inside it.
- **Auth.js v5 with the Drizzle adapter**, customized so every Auth.js timestamp column becomes a `bigint` epoch-millisecond column (PRD §7 "Authentication", §8.1; `rules/no-timestamp-columns.md`).
- **PostgreSQL via Drizzle ORM**, with every PK as `uuid("id").primaryKey().notNull().default(sql\`uuidv7()\`)` per `rules/no-uuid-default-random.md` and the existing pattern at `src/db/schemas/core/todos.ts:7`.
- **`pgvector` extension** on the `items` table for the validator's uniqueness check at cosine-similarity threshold 0.92 (PRD §3.2, §7).

---

## 2. Repository layout

The tree below lists every file the build will add (NEW) or modify (MOD) on top of the existing repository. One-line responsibility for each. Existing files unchanged are not listed.

```
src/
├── auth.ts                                                    # NEW: Auth.js v5 config — Google provider, Drizzle adapter wired to the bigint Auth.js schemas
├── auth.config.ts                                             # NEW: Edge-safe Auth.js config (callbacks, providers list) imported by middleware
├── middleware.ts                                              # NEW: Next.js middleware that gates every route except /api/auth/*, /login, /api/health
├── env.ts                                                     # MOD: add AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, ANTHROPIC_API_KEY, OPENAI_API_KEY
│
├── config/
│   ├── sub-types.ts                                           # NEW: 15 sub-type entries (id, displayName, section, latencyThresholdMs)
│   ├── strategies.ts                                          # NEW: Plain-text strategy notes keyed by sub-type id (PRD §6.4)
│   ├── admins.ts                                              # NEW: Hardcoded admin email allowlist (PRD §3.1)
│   └── item-templates.ts                                      # NEW: Per-sub-type structured prompt templates for the generator LLM (PRD §3.2)
│
├── db/
│   ├── schema.ts                                              # MOD: add the new schema modules to the dbSchema barrel
│   ├── lib/
│   │   └── pgvector.ts                                        # NEW: Drizzle custom column type for vector(1536) (PRD §7 "Vector search")
│   ├── programs/
│   │   └── extensions/
│   │       └── pgvector.ts                                    # NEW: CREATE EXTENSION IF NOT EXISTS vector — invoked from programs/index.ts
│   └── schemas/
│       ├── auth/
│       │   ├── users.ts                                       # NEW: Auth.js users table + 18seconds-specific columns (target_percentile, target_date_ms, timer_prefs_json)
│       │   ├── accounts.ts                                    # NEW: Auth.js accounts table; expires_at_ms, refresh_token_expires_at_ms as bigint
│       │   ├── auth_sessions.ts                               # NEW: Auth.js sessions table; expires_ms as bigint (renamed to avoid clash with app sessions table)
│       │   └── verification_tokens.ts                         # NEW: Auth.js verification_tokens table; expires_ms as bigint
│       ├── catalog/
│       │   ├── sub-types.ts                                   # NEW: sub_types table — id (text PK), name, section, latency_threshold_ms
│       │   ├── strategies.ts                                  # NEW: strategies table — strategy notes, FK to sub_types
│       │   └── items.ts                                       # NEW: items table — pgvector embedding, jsonb options, difficulty/source/status enums
│       ├── practice/
│       │   ├── sessions.ts                                    # NEW: sessions table — session type, narrowing_ramp flags, if_then_plan, started/ended ms
│       │   ├── attempts.ts                                    # NEW: attempts table — selected answer, latency_ms, triage flags
│       │   └── mastery_state.ts                               # NEW: mastery_state table — composite PK (user_id, sub_type_id), current_state enum
│       └── review/
│           └── review_queue.ts                                # NEW: review_queue table — due_at_ms, interval_days (SM-2 schedule per PRD §4.3)
│
├── server/
│   ├── auth/
│   │   └── admin-gate.ts                                      # NEW: requireAdminEmail() — reads session, checks src/config/admins.ts, throws ErrUnauthorized
│   ├── items/
│   │   ├── queries.ts                                         # NEW: prepared statements for item lookup, by sub-type/difficulty/status (PRD §4.2)
│   │   ├── ingest.ts                                          # NEW: ingestRealItem(input) — inserts source=real, status=live, fires embedding-backfill workflow
│   │   └── tagger.ts                                          # NEW: classifyItem(prompt, options) — LLM call returning {subTypeId, difficulty} for the admin form
│   ├── sessions/
│   │   ├── queries.ts                                         # NEW: prepared statements for session+attempt history
│   │   ├── start.ts                                           # NEW: startSession(userId, type, options) — creates a sessions row, returns session id
│   │   ├── submit.ts                                          # NEW: submitAttempt(sessionId, itemId, payload) — writes attempt, advances inline difficulty
│   │   ├── next.ts                                            # NEW: getNextItem(sessionId) — selects next item per adaptive rules (PRD §4.2)
│   │   └── end.ts                                             # NEW: endSession(sessionId) — finalizes ended_at_ms, triggers mastery-recompute workflow
│   ├── mastery/
│   │   ├── compute.ts                                         # NEW: computeMastery(attempts, threshold) — pure function over last 10 attempts (PRD §2 "Mastery state")
│   │   ├── recompute.ts                                       # NEW: recomputeForUser(userId, subTypeId) — reads attempts, writes mastery_state
│   │   └── near-goal.ts                                       # NEW: deriveNearGoal(user, masteryStates) — single-line "today's near goal" string (PRD §6.3)
│   ├── review/
│   │   ├── queries.ts                                         # NEW: dueReviewItems(userId, nowMs) prepared statement
│   │   └── schedule.ts                                        # NEW: scheduleReview(userId, itemId, lastIntervalDays, wasCorrect) — SM-2 next-due math (PRD §4.3)
│   ├── generation/
│   │   ├── pipeline.ts                                        # NEW: generateItem / validateItem / scoreItem / deployItem (PRD §3.2, §8.2)
│   │   ├── generator.ts                                       # NEW: Anthropic Claude Sonnet 4 wrapper — structured-output call
│   │   ├── validator.ts                                       # NEW: OpenAI GPT-4o wrapper — answer-correctness + ambiguity + difficulty checks
│   │   ├── embeddings.ts                                      # NEW: OpenAI text-embedding-3-small wrapper — returns number[] of length 1536
│   │   └── similarity.ts                                      # NEW: nearestNeighborInBank(subTypeId, embedding) — cosine query via Drizzle/pgvector
│   └── narrowing-ramp/
│       └── obstacle.ts                                        # NEW: suggestObstacleOptions(userId) — weakest sub-types + recent failure patterns (PRD §5.3)
│
├── workflows/
│   ├── item-generation.ts                                     # NEW: itemGenerationWorkflow(input) — runs the four pipeline stages as steps with retries
│   ├── mastery-recompute.ts                                   # NEW: masteryRecomputeWorkflow(sessionId) — recomputes affected sub-types after a session ends
│   ├── review-queue-refresh.ts                                # NEW: reviewQueueRefreshWorkflow(userId) — refreshes due dates after a session
│   └── embedding-backfill.ts                                  # NEW: embeddingBackfillWorkflow(itemId) — computes + writes embedding for a newly ingested item
│
├── components/
│   ├── focus-shell/
│   │   ├── focus-shell.tsx                                    # NEW: <FocusShell> client component — load-bearing timer/dim/triage primitive (PRD §5.1)
│   │   ├── session-timer-bar.tsx                              # NEW: <SessionTimerBar> — depletes left→inward, numeric readout on the right
│   │   ├── pace-track.tsx                                     # NEW: <PaceTrack> — discrete blocks, one per remaining question, depletes from the left
│   │   ├── question-timer-bar.tsx                             # NEW: <QuestionTimerBar> — per-question countdown, OFF by default
│   │   ├── triage-prompt.tsx                                  # NEW: <TriagePrompt> — "Best move: guess and advance" overlay rendered after 18s
│   │   ├── inter-question-card.tsx                            # NEW: <InterQuestionCard> — 200ms pause card between items
│   │   └── shell-reducer.ts                                   # NEW: pure reducer for FocusShell state (PRD §7 "What's intentionally not in the stack" — useReducer)
│   ├── item/
│   │   ├── item-prompt.tsx                                    # NEW: renders item.prompt + options for both real and generated items
│   │   └── option-button.tsx                                  # NEW: a single answer-option button used inside item-prompt
│   ├── mastery-map/
│   │   ├── mastery-map.tsx                                    # NEW: <MasteryMap> — 15 mastery icons + near-goal line + start CTA (PRD §5.2)
│   │   ├── mastery-icon.tsx                                   # NEW: <MasteryIcon> — fill state per current_state enum (lucide-react icons)
│   │   ├── near-goal-line.tsx                                 # NEW: <NearGoalLine> — single text line, no graph
│   │   └── start-session-button.tsx                           # NEW: primary CTA tied to the recommended next session
│   ├── narrowing-ramp/
│   │   ├── narrowing-ramp.tsx                                 # NEW: orchestrates the 75s pre-session protocol (PRD §5.3)
│   │   ├── obstacle-scan.tsx                                  # NEW: 30s obstacle picker + if-then plan editor
│   │   ├── visual-narrowing.tsx                               # NEW: 15s fixation point + slow-moving target
│   │   ├── session-brief.tsx                                  # NEW: 15s plain-text preview
│   │   └── launch-countdown.tsx                               # NEW: 15s countdown with periphery already dimmed
│   └── post-session/
│       ├── post-session-review.tsx                            # NEW: <PostSessionReview> — accuracy/latency/triage/wrong-items (PRD §6.5)
│       ├── strategy-review-gate.tsx                           # NEW: 30s strategy gate after full-length tests only
│       └── wrong-items-list.tsx                               # NEW: browsable wrong-item list with explanations
│
├── app/
│   ├── layout.tsx                                             # MOD: keep existing fonts; no per-route changes
│   ├── page.tsx                                               # MOD: replace todos demo with Mastery Map server component (post-auth)
│   ├── content.tsx                                            # MOD/DELETE: todos demo content moves out (use mastery-map instead)
│   ├── actions.ts                                             # MOD/DELETE: replaced by feature-scoped action files below
│   ├── api/
│   │   ├── auth/
│   │   │   └── [...nextauth]/route.ts                         # NEW: Auth.js v5 route handler (GET/POST)
│   │   ├── health/route.ts                                    # NEW: 200 OK probe — bypasses middleware
│   │   └── admin/
│   │       ├── generate-items/route.ts                        # NEW: POST — admin-gated, enqueues itemGenerationWorkflow
│   │       └── ingest-item/route.ts                           # NEW: POST — admin-gated, calls server/items/ingest.ts
│   ├── login/
│   │   └── page.tsx                                           # NEW: single Google sign-in button
│   ├── (app)/
│   │   ├── layout.tsx                                         # NEW: auth-required layout — wraps every user-facing route
│   │   ├── page.tsx                                           # NEW: server component → MasteryMap; post-diagnostic only
│   │   ├── actions.ts                                         # NEW: server actions startSession / submitAttempt / endSession
│   │   ├── diagnostic/
│   │   │   ├── page.tsx                                       # NEW: diagnostic flow shell, runs once on first use (PRD §4.1)
│   │   │   └── content.tsx                                    # NEW: client wrapper that drives FocusShell through 50 calibration items
│   │   ├── drill/
│   │   │   └── [subTypeId]/
│   │   │       ├── page.tsx                                   # NEW: drill flow shell, gated by NarrowingRamp
│   │   │       └── content.tsx                                # NEW: client wrapper that drives FocusShell with timer-mode prop
│   │   ├── test/
│   │   │   ├── page.tsx                                       # NEW: full-length practice test (50 q / 15 min)
│   │   │   └── content.tsx                                    # NEW: client wrapper for FocusShell with the strict full-length config
│   │   ├── simulation/
│   │   │   ├── page.tsx                                       # NEW: test-day simulation (PRD §4.6)
│   │   │   └── content.tsx                                    # NEW: client wrapper with stricter UI (no pause, no skip indicators)
│   │   ├── review/
│   │   │   ├── page.tsx                                       # NEW: spaced-repetition session built from due review_queue rows
│   │   │   └── content.tsx                                    # NEW: client wrapper for FocusShell over due items
│   │   ├── post-session/
│   │   │   └── [sessionId]/
│   │   │       ├── page.tsx                                   # NEW: server component → PostSessionReview
│   │   │       └── actions.ts                                 # NEW: dismissPostSession server action (writes the strategy-review-viewed flag)
│   │   └── history/
│   │       ├── page.tsx                                       # NEW: chronological list of sessions
│   │       └── [sessionId]/page.tsx                           # NEW: per-question breakdown for a single past session
│   └── (admin)/
│       ├── layout.tsx                                         # NEW: admin layout — calls requireAdminEmail()
│       ├── ingest/
│       │   ├── page.tsx                                       # NEW: real-item ingest form (PRD §3.1)
│       │   └── actions.ts                                     # NEW: ingestItemAction server action
│       └── generate/
│           ├── page.tsx                                       # NEW: trigger panel for generation runs (per-sub-type, batch size)
│           └── actions.ts                                     # NEW: triggerGenerationAction server action
│
└── lib/
    └── utils.ts                                               # already exists (cn helper)
```

### New dependencies

The PRD requires the libraries below; none of them are in `package.json` yet (verified against the file at the time of writing). Add them with `bun add`:

- `next-auth@beta` and `@auth/drizzle-adapter` — Auth.js v5 (PRD §7).
- `@anthropic-ai/sdk` — generator LLM (PRD §7).
- `openai` — validator LLM and embeddings (PRD §7).
- `motion` — Framer Motion successor used by `motion/react` (PRD §7 "Animations").

`pgvector` is a Postgres extension, not an npm package — installed via `src/db/programs/extensions/pgvector.ts` (see §3 below). The Drizzle integration is a custom column type written by hand in `src/db/lib/pgvector.ts`; no `drizzle-orm/pg-core/vector` import exists in the installed `drizzle-orm@0.45.2`.

`workflow@4.2.4` is already installed (`package.json:46`) and is the runtime for the `"use workflow"` / `"use step"` directives demonstrated in `src/workflows/example.ts`.

---

## 3. Database schema

All `id` columns use UUIDv7 via `default(sql\`uuidv7()\`)` — see `src/db/schemas/core/todos.ts:7` for the pattern and `rules/no-uuid-default-random.md` for the rule. All time-bearing columns are `bigint("col_name", { mode: "number" })` with the `_ms` suffix per `rules/no-timestamp-columns.md` and PRD §8.1.

Each table lives in one file under `src/db/schemas/<domain>/` per the existing convention (`src/db/schemas/core/todos.ts`) and is barrel-exported through `src/db/schema.ts`. Custom column type for the embedding lives in `src/db/lib/pgvector.ts` and is enabled by the program in `src/db/programs/extensions/pgvector.ts`.

### 3.1 `pgvector` Drizzle column type

`src/db/lib/pgvector.ts` exports a `vector(name, { dimensions })` helper using Drizzle's `customType` API:

```ts
import { customType } from "drizzle-orm/pg-core"

const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
    dataType(config) {
        return `vector(${config.dimensions})`
    },
    toDriver(value) {
        return `[${value.join(",")}]`
    },
    fromDriver(value) {
        return JSON.parse(value)
    }
})

export { vector }
```

### 3.2 Auth.js tables (with `bigint` time columns)

Per PRD §7 "Authentication": Auth.js's default Drizzle schema uses `timestamp` columns; the ruleset bans those. We rewrite the four Auth.js tables in `src/db/schemas/auth/` so every time-bearing column is `bigint(... _ms)`.

#### `src/db/schemas/auth/users.ts` — table `users`

| column | type | constraint |
|---|---|---|
| `id` | `uuid` | PK, `notNull`, `default uuidv7()` |
| `name` | `varchar(256)` | nullable |
| `email` | `varchar(320)` | `notNull`, `unique` |
| `email_verified_ms` | `bigint` (`mode: "number"`) | nullable |
| `image` | `text` | nullable |
| `target_percentile` | `integer` | nullable (PRD §6.3) |
| `target_date_ms` | `bigint` | nullable |
| `timer_prefs_json` | `jsonb` | `notNull`, `default '{}'` (PRD §5.1 visibility persistence) |
| `created_at_ms` | `bigint` | `notNull`, `default extract(epoch from now()) * 1000` |

Indexes: `email_idx` (unique).

#### `src/db/schemas/auth/accounts.ts` — table `accounts`

Columns matching Auth.js's adapter contract, but with bigint times:

| column | type | constraint |
|---|---|---|
| `user_id` | `uuid` | `notNull`, FK → `users.id`, `onDelete cascade` |
| `type` | `varchar(64)` | `notNull` |
| `provider` | `varchar(128)` | `notNull` |
| `provider_account_id` | `varchar(256)` | `notNull` |
| `refresh_token` | `text` | nullable |
| `access_token` | `text` | nullable |
| `expires_at_ms` | `bigint` | nullable |
| `token_type` | `varchar(64)` | nullable |
| `scope` | `text` | nullable |
| `id_token` | `text` | nullable |
| `session_state` | `text` | nullable |

Composite PK: `(provider, provider_account_id)`. Index on `user_id`.

#### `src/db/schemas/auth/auth_sessions.ts` — table `auth_sessions`

Renamed from Auth.js's default `sessions` to avoid clashing with the application's `practice/sessions` table.

| column | type | constraint |
|---|---|---|
| `session_token` | `varchar(256)` | PK |
| `user_id` | `uuid` | `notNull`, FK → `users.id`, `onDelete cascade` |
| `expires_ms` | `bigint` | `notNull` |

#### `src/db/schemas/auth/verification_tokens.ts` — table `verification_tokens`

| column | type | constraint |
|---|---|---|
| `identifier` | `varchar(320)` | `notNull` |
| `token` | `varchar(256)` | `notNull` |
| `expires_ms` | `bigint` | `notNull` |

Composite PK: `(identifier, token)`.

The Drizzle adapter is initialised with these tables in `src/auth.ts` (see §5).

### 3.3 Catalog tables

#### `src/db/schemas/catalog/sub-types.ts` — table `sub_types`

| column | type | constraint |
|---|---|---|
| `id` | `varchar(64)` | PK (e.g. `"verbal.synonyms"` per PRD §2) |
| `name` | `varchar(128)` | `notNull` |
| `section` | `pgEnum('sub_type_section', ['verbal','numerical','abstract'])` | `notNull` |
| `latency_threshold_ms` | `bigint` | `notNull` |

Note: this is the only table that does NOT use a UUIDv7 PK — sub-type ids are stable, human-readable strings used as foreign keys throughout. Seeded from `src/config/sub-types.ts` via the migration step.

#### `src/db/schemas/catalog/strategies.ts` — table `strategies`

| column | type | constraint |
|---|---|---|
| `id` | `uuid` | PK, `default uuidv7()` |
| `sub_type_id` | `varchar(64)` | `notNull`, FK → `sub_types.id` |
| `text` | `text` | `notNull` |

Index: `strategies_sub_type_idx` on `sub_type_id`.

#### `src/db/schemas/catalog/items.ts` — table `items`

| column | type | constraint |
|---|---|---|
| `id` | `uuid` | PK, `default uuidv7()` |
| `sub_type_id` | `varchar(64)` | `notNull`, FK → `sub_types.id` |
| `difficulty` | `pgEnum('item_difficulty', ['easy','medium','hard','brutal'])` | `notNull` |
| `source` | `pgEnum('item_source', ['real','generated'])` | `notNull` |
| `status` | `pgEnum('item_status', ['live','candidate','retired'])` | `notNull`, `default 'candidate'` |
| `prompt` | `text` | `notNull` |
| `image_url` | `text` | nullable (for abstract items per PRD §2 "Items") |
| `options_json` | `jsonb` | `notNull` (typed as `{ id: string; text: string; imageUrl?: string }[]`) |
| `correct_answer` | `varchar(64)` | `notNull` (matches an `option.id`) |
| `explanation` | `text` | nullable |
| `strategy_id` | `uuid` | nullable, FK → `strategies.id` |
| `embedding` | `vector(1536)` | nullable (set by `embeddingBackfillWorkflow`) |
| `metadata_json` | `jsonb` | `notNull`, `default '{}'` (template id, generator model, validator outcome, quality score per PRD §3.2) |

Indexes:
- `items_sub_type_status_idx` on `(sub_type_id, status)` — primary lookup path for `getNextItem`.
- `items_embedding_ivfflat_idx` on `embedding` using `ivfflat (embedding vector_cosine_ops) WITH (lists = 100)` — required for `similarity.ts`.

### 3.4 Practice tables

#### `src/db/schemas/practice/sessions.ts` — table `sessions`

| column | type | constraint |
|---|---|---|
| `id` | `uuid` | PK, `default uuidv7()` |
| `user_id` | `uuid` | `notNull`, FK → `users.id`, `onDelete cascade` |
| `type` | `pgEnum('session_type', ['diagnostic','drill','full_length','simulation','review'])` | `notNull` |
| `sub_type_id` | `varchar(64)` | nullable, FK → `sub_types.id` (only set for `drill` and `review` sessions) |
| `timer_mode` | `pgEnum('timer_mode', ['standard','speed_ramp','brutal'])` | nullable (only set for `drill`) |
| `started_at_ms` | `bigint` | `notNull` |
| `ended_at_ms` | `bigint` | nullable (set by `endSession`) |
| `narrowing_ramp_completed` | `boolean` | `notNull`, `default false` |
| `if_then_plan` | `text` | nullable (PRD §5.3 obstacle-scan output) |
| `strategy_review_viewed` | `boolean` | `notNull`, `default false` (PRD §6.5 — full-length 30s gate) |

Indexes: `sessions_user_id_idx` on `user_id`.

Recover `created_at` via `timestampFromUuidv7(row.id)` from `src/db/lib/uuid-time.ts:14`. `started_at_ms` is recorded explicitly because it is set from the user's clock (NarrowingRamp end) and may differ from row insertion.

#### `src/db/schemas/practice/attempts.ts` — table `attempts`

| column | type | constraint |
|---|---|---|
| `id` | `uuid` | PK, `default uuidv7()` |
| `session_id` | `uuid` | `notNull`, FK → `sessions.id`, `onDelete cascade` |
| `item_id` | `uuid` | `notNull`, FK → `items.id` |
| `selected_answer` | `varchar(64)` | nullable (null = skipped/timeout) |
| `correct` | `boolean` | `notNull` |
| `latency_ms` | `integer` | `notNull` (per PRD §8.3 — `performance.now()` precision) |
| `triage_prompt_fired` | `boolean` | `notNull`, `default false` (PRD §6.1) |
| `triage_taken` | `boolean` | `notNull`, `default false` |

Indexes:
- `attempts_session_id_idx` on `session_id` — drives post-session review.
- `attempts_item_id_idx` on `item_id` — drives candidate-item promotion (PRD §3.2 "Promotion or retirement").

Recover `created_at` for chronological ordering via `timestampFromUuidv7(attempt.id)`; ordering by `id DESC` walks the PK index in reverse-chronological order per `rules/no-timestamp-columns.md`.

#### `src/db/schemas/practice/mastery_state.ts` — table `mastery_state`

| column | type | constraint |
|---|---|---|
| `user_id` | `uuid` | `notNull`, FK → `users.id`, `onDelete cascade` |
| `sub_type_id` | `varchar(64)` | `notNull`, FK → `sub_types.id` |
| `current_state` | `pgEnum('mastery_level', ['learning','fluent','mastered','decayed'])` | `notNull` |
| `updated_at_ms` | `bigint` | `notNull` |

Composite PK: `(user_id, sub_type_id)`.

### 3.5 Review tables

#### `src/db/schemas/review/review_queue.ts` — table `review_queue`

| column | type | constraint |
|---|---|---|
| `id` | `uuid` | PK, `default uuidv7()` |
| `user_id` | `uuid` | `notNull`, FK → `users.id`, `onDelete cascade` |
| `item_id` | `uuid` | `notNull`, FK → `items.id` |
| `due_at_ms` | `bigint` | `notNull` |
| `interval_days` | `integer` | `notNull` (one of 1, 3, 7, 21 per PRD §4.3) |

Indexes:
- `review_queue_user_due_idx` on `(user_id, due_at_ms)` — drives `dueReviewItems`.
- `review_queue_user_item_unique` UNIQUE on `(user_id, item_id)` — at most one queued review per (user, item).

### 3.6 Schema barrel

`src/db/schema.ts` (existing file) is updated to barrel all of the above; it currently barrels only `coreTodos` (`src/db/schema.ts:3`):

```ts
import * as authUsers from "@/db/schemas/auth/users"
import * as authAccounts from "@/db/schemas/auth/accounts"
// ... and so on for every schema file added in §3.2–§3.5
const dbSchema = { ...authUsers, ...authAccounts, /* ... */ }
```

`coreTodos` and the demo `app/page.tsx` flow are removed once the diagnostic flow lands.

### 3.7 Database programs

`src/db/programs/extensions/pgvector.ts` is a new file that follows the shape of `src/db/programs/extensions/pgcrypto.ts:4` and returns `sql\`CREATE EXTENSION IF NOT EXISTS vector\``. It is added to the `programs` array in `src/db/programs/index.ts:14`, placed after `pgcrypto()` and before the `grant*ToAppUser()` calls so that the extension exists before grants execute.

---

## 4. Configuration files

### 4.1 `src/config/sub-types.ts`

Single source of truth for the 15 sub-types per PRD §2. Exports a `subTypes` array of:

```ts
interface SubTypeConfig {
    id: SubTypeId
    displayName: string
    section: "verbal" | "numerical" | "abstract"
    latencyThresholdMs: number
}
```

The 15 entries (from PRD §2):

```
verbal.synonyms             | "Synonyms"             | verbal     | latencyThresholdMs: 12000
verbal.antonyms             | "Antonyms"             | verbal     | latencyThresholdMs: 12000
verbal.analogies            | "Analogies"            | verbal     | latencyThresholdMs: 15000
verbal.sentence_completion  | "Sentence Completion"  | verbal     | latencyThresholdMs: 15000
verbal.logic                | "Logic"                | verbal     | latencyThresholdMs: 18000
numerical.number_series     | "Number Series"        | numerical  | latencyThresholdMs: 15000
numerical.word_problems     | "Word Problems"        | numerical  | latencyThresholdMs: 18000
numerical.fractions         | "Fractions"            | numerical  | latencyThresholdMs: 15000
numerical.percentages       | "Percentages"          | numerical  | latencyThresholdMs: 15000
numerical.averages_ratios   | "Averages & Ratios"    | numerical  | latencyThresholdMs: 15000
abstract.odd_one_out        | "Odd One Out"          | abstract   | latencyThresholdMs: 15000
abstract.shape_series       | "Shape Series"         | abstract   | latencyThresholdMs: 18000
abstract.matrix             | "Matrix"               | abstract   | latencyThresholdMs: 18000
abstract.transformations    | "Transformations"      | abstract   | latencyThresholdMs: 18000
abstract.next_in_series     | "Next in Series"       | abstract   | latencyThresholdMs: 18000
```

`SubTypeId` is a `as const` union of the 15 string ids. Initial latency thresholds set tighter than 18s per PRD §2; final values are an open question — see §13.

A migration in `src/db/scripts/seed-sub-types.ts` (NEW) populates the `sub_types` table from this file.

### 4.2 `src/config/strategies.ts`

Exports a `strategies: Record<SubTypeId, string[]>` map. One or two plain-text entries per sub-type per PRD §6.4. Sample content (drawn from `docs/CCAT-categories.md`):

```ts
const strategies = {
    "verbal.antonyms": [
        "When two answers seem opposite, the correct answer is usually the more general opposite."
    ],
    "numerical.number_series": [
        "Test differences between consecutive terms before testing ratios.",
        "If first-order differences are non-constant, look at differences-of-differences."
    ],
    // ... entries for every sub-type id
}
```

A migration script populates the `strategies` table from this file.

### 4.3 `src/config/admins.ts`

Hardcoded admin email allowlist per PRD §3.1:

```ts
// Add admin email addresses here. Lowercase only. Compared case-insensitively
// in src/server/auth/admin-gate.ts.
const adminEmails: readonly string[] = []

export { adminEmails }
```

### 4.4 `src/config/item-templates.ts`

One template per sub-type, formatted as the structured prompt the generator LLM will receive (PRD §3.2 "Template selection"):

```ts
interface ItemTemplate {
    subTypeId: SubTypeId
    version: number
    systemPrompt: string
    userPromptFor(difficulty: Difficulty): string
    schema: z.ZodTypeAny  // matches the structured-output JSON shape
}

const templates: Record<SubTypeId, ItemTemplate> = {
    "verbal.antonyms": {
        subTypeId: "verbal.antonyms",
        version: 1,
        systemPrompt: "You generate CCAT-style antonym practice items. Output JSON only.",
        userPromptFor(difficulty) {
            return `Generate a CCAT antonym question. Provide a target word, exactly 5 options, and the id of the correct option. The correct option should be the clearest opposite. Difficulty: ${difficulty}.`
        },
        schema: z.object({
            prompt: z.string(),
            options: z.array(z.object({ id: z.string(), text: z.string() })).length(5),
            correctAnswer: z.string(),
            explanation: z.string()
        })
    },
    // ... one entry per sub-type id
}
```

Templates are versioned so a regeneration run can be associated with a specific template version in `items.metadata_json.templateId`.

---

## 5. Authentication

### 5.1 `src/auth.ts`

Auth.js v5 (`next-auth@beta`) wired to the Drizzle adapter against the bigint Auth.js schemas from §3.2.

```ts
import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { db } from "@/db"
import { users } from "@/db/schemas/auth/users"
import { accounts } from "@/db/schemas/auth/accounts"
import { authSessions } from "@/db/schemas/auth/auth_sessions"
import { verificationTokens } from "@/db/schemas/auth/verification_tokens"
import { env } from "@/env"

const { handlers, auth, signIn, signOut } = NextAuth({
    adapter: DrizzleAdapter(db, {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: authSessions,
        verificationTokensTable: verificationTokens
    }),
    providers: [
        Google({
            clientId: env.AUTH_GOOGLE_ID,
            clientSecret: env.AUTH_GOOGLE_SECRET
        })
    ],
    session: { strategy: "database" },
    secret: env.AUTH_SECRET
})

export { handlers, auth, signIn, signOut }
```

Note on the bigint schema: the Auth.js Drizzle adapter calls `expires`/`expiresAt`/`emailVerified` on the configured tables. With our renamed columns the adapter sees `expires_ms`, `expires_at_ms`, `email_verified_ms`. Auth.js's adapter type accepts the number form when the Drizzle column declares `mode: "number"`, but conversion at the adapter boundary is the implementer's responsibility — write a thin adapter wrapper if needed; this is flagged in §13.

### 5.2 `src/auth.config.ts`

Edge-safe slice of the config (no Drizzle adapter import) used by `src/middleware.ts`. Contains only the providers list and auth callbacks. Required because middleware runs in the Edge runtime where `pg` cannot be loaded.

### 5.3 Environment variables

Add to `src/env.ts:29` (`server` schema), keeping the existing `runtimeEnv` mapping pattern at `src/env.ts:52`:

```ts
AUTH_SECRET: z.string().min(32),
AUTH_GOOGLE_ID: z.string().min(1),
AUTH_GOOGLE_SECRET: z.string().min(1),
ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-"),
OPENAI_API_KEY: z.string().startsWith("sk-"),
```

And the matching `runtimeEnv` entries reading from `process.env.*`. Update `.env.example` to document the new variables.

### 5.4 `src/middleware.ts`

Protects every route except `/api/auth/*`, `/login`, `/api/health`. Uses `src/auth.config.ts` to stay edge-compatible.

```ts
import { auth } from "@/auth.config"

const PUBLIC_PREFIXES = ["/api/auth", "/login", "/api/health"]

export default auth((req) => {
    const path = req.nextUrl.pathname
    for (const prefix of PUBLIC_PREFIXES) {
        if (path.startsWith(prefix)) return
    }
    if (!req.auth) {
        const loginUrl = new URL("/login", req.nextUrl.origin)
        return Response.redirect(loginUrl)
    }
})

export const config = { matcher: ["/((?!_next/static|_next/image|favicon).*)"] }
```

### 5.5 Admin gate

`src/server/auth/admin-gate.ts` exports `requireAdminEmail()` — reads the current Auth.js session, lower-cases the email, checks membership in `src/config/admins.ts`. Throws `errors.wrap(ErrUnauthorized, "admin gate")` per `rules/error-handling.md`. Imported by `src/app/(admin)/layout.tsx` and the two admin route handlers under `src/app/api/admin/*`.

```ts
const ErrUnauthorized = errors.new("unauthorized")
async function requireAdminEmail(): Promise<{ userId: string; email: string }> {
    const session = await auth()
    if (!session?.user?.email) {
        logger.warn({}, "admin gate: no session")
        throw errors.wrap(ErrUnauthorized, "no session")
    }
    const email = session.user.email.toLowerCase()
    if (!adminEmails.includes(email)) {
        logger.warn({ email }, "admin gate: email not in allowlist")
        throw errors.wrap(ErrUnauthorized, "email not in admin allowlist")
    }
    return { userId: session.user.id, email }
}
export { ErrUnauthorized, requireAdminEmail }
```

---

## 6. The focus shell

The single load-bearing client primitive of the application (PRD §5.1, §7 "Focus shell implementation specifics"). Lives at `src/components/focus-shell/focus-shell.tsx`.

### 6.1 Component signature

```ts
"use client"

interface FocusShellProps {
    sessionId: string
    sessionType: "diagnostic" | "drill" | "full_length" | "simulation" | "review"
    sessionDurationMs: number          // overall session timer length
    perQuestionTargetMs: number        // 18000 for standard, 12000 for speed-ramp
    initialTimerPrefs: TimerPrefs      // from users.timer_prefs_json
    ifThenPlan?: string                // from sessions.if_then_plan; replaces generic triage prompt
    initialItem: ItemForRender         // first item, server-rendered
    onSubmitAttempt: (input: SubmitAttemptInput) => Promise<SubmitAttemptResult>  // server action
    onEndSession: () => Promise<void>  // server action
}

interface TimerPrefs {
    sessionTimerVisible: boolean   // ON by default for full-length, simulation, drill, diagnostic
    questionTimerVisible: boolean  // OFF by default for all session types
}

interface ItemForRender {
    id: string
    prompt: string
    imageUrl?: string
    options: { id: string; text: string; imageUrl?: string }[]
}

interface SubmitAttemptInput {
    itemId: string
    selectedAnswer?: string         // undefined = skipped/timeout
    latencyMs: number               // performance.now() submit - performance.now() first paint
    triagePromptFired: boolean
    triageTaken: boolean
}

interface SubmitAttemptResult {
    nextItem?: ItemForRender        // undefined = session over (caller routes to post-session)
}
```

### 6.2 Internal state (managed by `shell-reducer.ts`)

Per PRD §7 "What's intentionally not in the stack" — global state libraries are banned; the shell uses `useReducer`.

```ts
interface ShellState {
    currentItem: ItemForRender
    questionStartedAtMs: number          // performance.now() at first paint of currentItem
    sessionStartedAtMs: number
    elapsedQuestionMs: number            // updated by requestAnimationFrame
    elapsedSessionMs: number
    timerPrefs: TimerPrefs
    triagePromptFired: boolean           // flips true once elapsedQuestionMs >= 18000
    selectedOptionId?: string
    interQuestionVisible: boolean        // 200ms fade between items
    questionsRemaining: number           // for the pace track
}

type ShellAction =
    | { kind: "tick"; nowMs: number }
    | { kind: "select"; optionId: string }
    | { kind: "submit" }                  // user clicks an option
    | { kind: "triage_take" }             // user accepts the triage prompt
    | { kind: "advance"; next?: ItemForRender }
    | { kind: "toggle_session_timer" }
    | { kind: "toggle_question_timer" }
```

### 6.3 Layout

CSS Grid with named template areas per PRD §7:

```css
grid-template-areas:
    "header"
    "content"
    "footer";
grid-template-rows: auto 1fr auto;
```

- `header` — `<SessionTimerBar>` and `<PaceTrack>` stacked, both dimmed to ~20% opacity per PRD §5.1.
- `content` — `<ItemPrompt>`. The ONLY fully-illuminated area (opacity 1.0).
- `footer` — `<QuestionTimerBar>` when `timerPrefs.questionTimerVisible`.

`<TriagePrompt>` is rendered as an overlay layer outside the named areas, conditionally on `triagePromptFired`. Dimming is animated by tweening `opacity` on each named area independently using `motion/react`.

### 6.4 Timer animation strategy

- `requestAnimationFrame` loop, NOT `setInterval` (PRD §7). Loop dispatches a `{ kind: "tick", nowMs: performance.now() }` action.
- All elapsed values derived from `performance.now()` minus the captured start values. No clock drift.
- On `submit`, the loop reads the final `performance.now()` and includes `latencyMs = submitNow - questionStartedAtMs` in `SubmitAttemptInput`.
- Question start (`questionStartedAtMs`) is captured in a `useEffect` with no deps inside an inner `<ItemSlot>` keyed by `currentItem.id`, so it runs at first paint of every new item.

### 6.5 Latency measurement

Per PRD §7, §8.3:

- Start: `performance.now()` captured in the `<ItemSlot>` mount effect (fires after first paint of the new item).
- End: `performance.now()` captured in the click handler that dispatches `submit`.
- Difference is the `latency_ms` written to `attempts.latency_ms` (an `integer` column in §3.4).
- The shell does not round; the database column is `integer` so the value is implicitly truncated by `Math.floor` at the boundary.

### 6.6 Three peripheral elements

| element | shape | depletion direction | default visibility | toggleable mid-session? |
|---|---|---|---|---|
| `<SessionTimerBar>` | horizontal bar in `header`, with numeric readout (e.g. `8:42`) at the right end | left edge inward (right portion shrinks toward the right edge) | ON for diagnostic, drill, full-length, simulation, review | yes; toggling also hides the pace track per PRD §5.1 |
| `<PaceTrack>` | horizontal bar of discrete blocks (one per question), same height as session timer bar | leftmost block removed on each submit | tied to session timer visibility | togglable only via the session timer toggle |
| `<QuestionTimerBar>` | horizontal bar in `footer`, depletes as the per-question target counts down | left edge inward | OFF for all session types unless previously enabled | yes |

`timerPrefs` is persisted per user. After every toggle, a server action writes `users.timer_prefs_json` so the next session starts in the same state per PRD §5.1.

### 6.7 Triage prompt

When `elapsedQuestionMs >= 18000` and `triagePromptFired` is false, the reducer flips `triagePromptFired = true` and the `<TriagePrompt>` overlay fades in. Two render rules:

- If `ifThenPlan` is non-empty AND the plan was tagged as a triage plan, render `ifThenPlan` text instead of the generic message (PRD §5.3, "Mid-session, if the user's stored if-then plan's trigger fires").
- Otherwise render: `Best move: guess and advance.`

The user can click the prompt to take it; this dispatches `triage_take`, which auto-submits the currently-selected option (or a random option per PRD §6.1 if none is selected). The reducer marks `triageTaken = true` only if the submit happens within 3000ms of `triagePromptFired` becoming true (PRD §6.1).

Triage rendering is independent of timer-bar visibility — it appears regardless of toggle state per PRD §5.1.

### 6.8 Inter-question card

After `submit` and before the next item paints, `<InterQuestionCard>` fades in for ~200ms (no progress count, no item index per PRD §5.1 "no visible progress count"), giving the user a brief visual reset. The next item's `questionStartedAtMs` is captured AFTER the card fades out, in the `<ItemSlot>` mount effect.

---

## 7. Server actions and API routes

All server actions live at the closest `actions.ts` file under `src/app/(app)/...`. All follow the patterns demonstrated in `src/app/actions.ts`: file-top `"use server"`; mutations use `errors.try` around DB calls (`rules/no-try.md`); errors are logged then thrown via `errors.wrap` (`rules/error-handling.md`); writes call `revalidatePath` (`src/app/actions.ts:26`).

API routes (Next.js Route Handlers) live under `src/app/api/`. They use the same `errors.try` pattern.

### 7.1 `startSession` — `src/app/(app)/actions.ts`

Signature:
```ts
async function startSession(input: StartSessionInput): Promise<{ sessionId: string; firstItem: ItemForRender }>
interface StartSessionInput {
    type: "diagnostic" | "drill" | "full_length" | "simulation" | "review"
    subTypeId?: SubTypeId          // required for drill, review
    timerMode?: "standard" | "speed_ramp" | "brutal"   // required for drill
    ifThenPlan?: string            // captured by NarrowingRamp
}
```

Side effects:
- Reads `auth()` to resolve `userId` (throw `ErrUnauthorized` if missing).
- Inserts a `sessions` row with `started_at_ms = Date.now()`, `narrowing_ramp_completed = !!input.ifThenPlan`.
- Calls `getNextItem(sessionId)` synchronously to return the first item.

Tables touched: `sessions` (insert), `items` (select via `getNextItem`).

### 7.2 `submitAttempt` — `src/app/(app)/actions.ts`

Signature:
```ts
async function submitAttempt(input: {
    sessionId: string
    itemId: string
    selectedAnswer?: string
    latencyMs: number
    triagePromptFired: boolean
    triageTaken: boolean
}): Promise<{ nextItem?: ItemForRender }>
```

Side effects:
- Resolves the item's `correct_answer` to compute `correct: boolean`.
- Inserts an `attempts` row.
- Calls the inline difficulty stepper (§9) to maintain in-session adaptive state — written into a per-session in-memory key in a Map keyed by `sessionId`. (Adaptive state is ephemeral per PRD §4.2 "in the current sub-type within the current session" and does not need a column.)
- Calls `getNextItem(sessionId)` for the next item.
- Returns `{ nextItem: undefined }` when the session has reached its question quota.

Tables touched: `attempts` (insert), `items` (select).

### 7.3 `endSession` — `src/app/(app)/actions.ts`

Signature: `async function endSession(sessionId: string): Promise<void>`.

Side effects:
- Sets `sessions.ended_at_ms = Date.now()` for `sessionId`.
- Triggers `masteryRecomputeWorkflow(sessionId)` (fire-and-forget per PRD §8.3).
- Triggers `reviewQueueRefreshWorkflow(userId)`.
- Calls `revalidatePath(\`/post-session/${sessionId}\`)`.

Tables touched: `sessions` (update). Workflow consumers touch `attempts`, `mastery_state`, `review_queue`.

### 7.4 `getNextItem` — `src/server/sessions/next.ts`

Not a server action — invoked by `startSession` and `submitAttempt`. Implements the adaptive-difficulty selection from PRD §4.2 (see §9 below). Reads the in-memory per-session adaptive state, computes the target difficulty tier, and selects an item not yet served in this session.

Signature: `async function getNextItem(sessionId: string): Promise<ItemForRender | undefined>`.

Returns `undefined` when the session quota is reached (50 for diagnostic/full-length/simulation, configurable per drill, the count of due items for review). Tables: `items`, `attempts` (to compute already-served set), `review_queue` (for review sessions).

### 7.5 `dismissPostSession` — `src/app/(app)/post-session/[sessionId]/actions.ts`

Signature: `async function dismissPostSession(sessionId: string): Promise<void>`.

Side effects:
- For `full_length` sessions, sets `sessions.strategy_review_viewed = true`. Throws `ErrStrategyReviewRequired` if the gate has not yet elapsed (PRD §6.5).
- Calls `revalidatePath("/")`.

### 7.6 `ingestItemAction` — `src/app/(admin)/ingest/actions.ts`

Signature:
```ts
async function ingestItemAction(input: {
    subTypeId: SubTypeId
    difficulty: "easy" | "medium" | "hard" | "brutal"
    prompt: string
    imageUrl?: string
    options: { id: string; text: string; imageUrl?: string }[]
    correctAnswer: string
    explanation?: string
    strategyId?: string
}): Promise<{ itemId: string }>
```

Side effects (PRD §3.1):
- Calls `requireAdminEmail()` first; throws `ErrUnauthorized` on failure.
- Validates `input` with a Zod `safeParse` per `rules/zod-usage.md`.
- Inserts an `items` row with `source: "real"`, `status: "live"`, embedding NULL.
- Triggers `embeddingBackfillWorkflow(itemId)` so the embedding lands asynchronously per PRD §7 "Async work".
- Calls `revalidatePath("/admin/ingest")`.

### 7.7 `triggerGenerationAction` — `src/app/(admin)/generate/actions.ts`

Signature:
```ts
async function triggerGenerationAction(input: {
    subTypeId: SubTypeId
    difficulty: "easy" | "medium" | "hard" | "brutal"
    count: number              // bounded 1..50
}): Promise<{ enqueued: number }>
```

Side effects:
- Admin-gated.
- Enqueues `count` invocations of `itemGenerationWorkflow({ subTypeId, difficulty })`.

### 7.8 API route handlers

| route | method | purpose |
|---|---|---|
| `src/app/api/auth/[...nextauth]/route.ts` | `GET`, `POST` | Standard Auth.js v5 handlers — `export const { GET, POST } = handlers` from `src/auth.ts`. |
| `src/app/api/health/route.ts` | `GET` | Returns `200 {"ok":true}`. Bypassed by middleware (§5.4). |
| `src/app/api/admin/generate-items/route.ts` | `POST` | Admin-gated wrapper around `triggerGenerationAction` for non-form callers (PRD §8.2). |
| `src/app/api/admin/ingest-item/route.ts` | `POST` | Admin-gated wrapper around `ingestItemAction` for non-form callers (PRD §3.1). |

### 7.9 Error patterns

Every server action and API route follows `rules/error-handling.md` exactly. Module-level error sentinels per `rules/no-extends-error.md`:

```ts
import * as errors from "@superbuilders/errors"

const ErrSessionNotFound = errors.new("session not found")
const ErrItemNotFound = errors.new("item not found")
const ErrStrategyReviewRequired = errors.new("strategy review required before dismiss")
const ErrUnauthorized = errors.new("unauthorized")
```

`errors.try` follows the canonical shape from `src/app/actions.ts:12-18` — variable assignment, immediate `if (result.error)` block, log then `throw errors.wrap(...)` with no blank line in between (`rules/no-try.md` Case 4 requires the `if` block on the line immediately after).

---

## 8. The generation pipeline

PRD §3.2, §8.2. The pipeline is a single module at `src/server/generation/pipeline.ts` with four named stage functions:

```ts
async function generateItem(template: ItemTemplate, difficulty: Difficulty): Promise<RawItem>
async function validateItem(item: RawItem, subTypeId: SubTypeId): Promise<ValidatorReport>
async function scoreItem(item: RawItem, validatorReport: ValidatorReport): Promise<QualityScore>
async function deployItem(input: { item: RawItem; report: ValidatorReport; score: QualityScore; templateId: string }): Promise<{ itemId: string }>
```

Type shapes:

```ts
interface RawItem {
    prompt: string
    options: { id: string; text: string }[]
    correctAnswer: string
    explanation: string
}
interface ValidatorReport {
    answerCorrect: boolean
    unambiguous: boolean
    difficultyMatches: boolean
    nearestNeighborSimilarity: number   // cosine, 0..1
    nearestNeighborItemId?: string
    passed: boolean                      // all four checks passed AND similarity < 0.92
    failureReasons: string[]
}
interface QualityScore {
    estimatedDifficulty: "easy" | "medium" | "hard" | "brutal"
    distractorDistance: number           // mean pairwise embedding distance between options
    promptLength: number
    score: number                         // 0..1, used as an item.metadata_json field
}
```

### 8.1 `generateItem`

- Calls Anthropic Claude Sonnet 4 via `@anthropic-ai/sdk` (PRD §7).
- Uses the template's `systemPrompt` and `userPromptFor(difficulty)`.
- Parses the response via `template.schema.safeParse` per `rules/zod-usage.md`.
- Returns `RawItem`.

### 8.2 `validateItem`

- Calls a different model from the generator: OpenAI GPT-4o via the `openai` SDK (PRD §7 — distinct model from the generator to reduce shared-bias errors).
- Validator prompt asks four binary questions (answer correct? unambiguous? matches difficulty? sufficiently novel?).
- Embeds the item's prompt via `OPENAI text-embedding-3-small` (`src/server/generation/embeddings.ts`).
- Calls `nearestNeighborInBank(subTypeId, embedding)` from `src/server/generation/similarity.ts`, which runs a cosine-distance query against `items.embedding`:

```ts
const nearest = await db
    .select({ id: items.id, distance: sql<number>`embedding <=> ${embedding}` })
    .from(items)
    .where(and(eq(items.subTypeId, subTypeId), eq(items.source, "generated")))
    .orderBy(sql`embedding <=> ${embedding}`)
    .limit(1)
```

- `passed = answerCorrect && unambiguous && difficultyMatches && nearestNeighborSimilarity < 0.92` (PRD §3.2 cosine threshold).

### 8.3 `scoreItem`

- Computes `distractorDistance` by embedding each option text and averaging pairwise cosine distances (semantic distance between distractors per PRD §3.2).
- Records `promptLength` in characters.
- Heuristic `estimatedDifficulty` based on option-count, prompt-length, and distractorDistance buckets (concrete bucket boundaries are an open question — see §13).
- `score` is a 0..1 confidence the item is suitable.

### 8.4 `deployItem`

- Inserts an `items` row with `source: "generated"`, `status: "candidate"`, `embedding` set.
- Writes `metadata_json` containing `templateId`, `templateVersion`, `generatorModel`, `validatorReport`, `qualityScore`.
- Returns `{ itemId }`.

### 8.5 Workflow orchestration — `src/workflows/item-generation.ts`

Each pipeline stage is a `"use step"` function, and the workflow body is `"use workflow"` per the pattern in `src/workflows/example.ts:1-13`. Each step retries independently per PRD §7 "Async work":

```ts
async function generateStep(template: ItemTemplate, difficulty: Difficulty) {
    "use step"
    return generateItem(template, difficulty)
}
async function validateStep(item: RawItem, subTypeId: SubTypeId) {
    "use step"
    return validateItem(item, subTypeId)
}
async function scoreStep(item: RawItem, report: ValidatorReport) {
    "use step"
    return scoreItem(item, report)
}
async function deployStep(input: { item: RawItem; report: ValidatorReport; score: QualityScore; templateId: string }) {
    "use step"
    return deployItem(input)
}
async function itemGenerationWorkflow(input: { subTypeId: SubTypeId; difficulty: Difficulty }): Promise<{ itemId?: string; rejected?: string[] }> {
    "use workflow"
    const template = templates[input.subTypeId]
    const item = await generateStep(template, input.difficulty)
    const report = await validateStep(item, input.subTypeId)
    if (!report.passed) {
        return { rejected: report.failureReasons }
    }
    const score = await scoreStep(item, report)
    const { itemId } = await deployStep({ item, report, score, templateId: template.subTypeId + ":v" + template.version })
    return { itemId }
}
```

### 8.6 Promotion / retirement (PRD §3.2 step 6)

A second workflow `src/workflows/candidate-promotion.ts` (NOT in the §2 layout — implementation detail for §11 step 7) periodically scans candidate items with ≥20 attempts, computes observed accuracy and median latency, and either updates `status` to `live` or `retired`. Triggered nightly (cron via Vercel, out of scope for v1 — flagged in §13).

---

## 9. Adaptive difficulty and mastery state

### 9.1 Adaptive difficulty stepper (PRD §4.2)

Pure function over the in-session attempt window, exposed at `src/server/sessions/next.ts`:

```ts
type Tier = "easy" | "medium" | "hard" | "brutal"

interface AdaptiveContext {
    last10Correct: boolean[]            // most recent 10 in-session attempts on this sub-type
    last10LatencyMs: number[]
    currentTier: Tier
    latencyThresholdMs: number
}

function nextDifficultyTier(ctx: AdaptiveContext): Tier {
    if (ctx.last10Correct.length < 10) return ctx.currentTier
    const accuracy = ctx.last10Correct.filter(Boolean).length / ctx.last10Correct.length
    const medianLatency = median(ctx.last10LatencyMs)
    if (accuracy >= 0.9 && medianLatency < ctx.latencyThresholdMs * 0.8) return stepUp(ctx.currentTier)
    if (accuracy <= 0.6 || medianLatency > ctx.latencyThresholdMs * 1.2) return stepDown(ctx.currentTier)
    return ctx.currentTier
}
```

Tier ladder: `easy → medium → hard → brutal`. `stepUp`/`stepDown` clamp at the ends. The "comfortably under" / "well above" thresholds (here 0.8× and 1.2×) are open questions — see §13.

### 9.2 Mastery state (PRD §2 "Mastery state")

Pure function at `src/server/mastery/compute.ts` over the user's last 10 cross-session attempts on a sub-type:

```ts
type MasteryLevel = "learning" | "fluent" | "mastered" | "decayed"

interface ComputeMasteryInput {
    last10Correct: boolean[]
    last10LatencyMs: number[]
    latencyThresholdMs: number
    previousState: MasteryLevel | undefined
}

function computeMastery(input: ComputeMasteryInput): MasteryLevel {
    const n = input.last10Correct.length
    if (n < 5) return "learning"
    const accuracy = input.last10Correct.filter(Boolean).length / n
    const medianLatency = median(input.last10LatencyMs)
    if (accuracy < 0.7) return "learning"
    if (accuracy >= 0.8 && medianLatency <= input.latencyThresholdMs) return "mastered"
    if (accuracy >= 0.8 && medianLatency > input.latencyThresholdMs) return "fluent"
    if (input.previousState === "mastered" && (accuracy < 0.8 || medianLatency > input.latencyThresholdMs)) return "decayed"
    return "learning"
}
```

`recomputeForUser(userId, subTypeId)` in `src/server/mastery/recompute.ts` reads the most recent 10 attempts for the (user, sub-type) pair (ordered by `attempts.id DESC` per `rules/no-timestamp-columns.md`), the previous `mastery_state.current_state`, computes the new value, and upserts.

Triggered by `masteryRecomputeWorkflow(sessionId)` for every distinct sub-type touched in the session.

### 9.3 SM-2 spaced-repetition schedule (PRD §4.3)

`src/server/review/schedule.ts`:

```ts
const INTERVAL_LADDER = [1, 3, 7, 21] as const

function nextDueAtMs(input: { lastIntervalDays: number; wasCorrect: boolean; nowMs: number }): { nextDueAtMs: number; nextIntervalDays: number } {
    const currentIdx = INTERVAL_LADDER.indexOf(input.lastIntervalDays)
    const nextIdx = input.wasCorrect ? Math.min(currentIdx + 1, INTERVAL_LADDER.length - 1) : 0
    const nextIntervalDays = INTERVAL_LADDER[nextIdx]
    return { nextDueAtMs: input.nowMs + nextIntervalDays * 86_400_000, nextIntervalDays }
}
```

`scheduleReview` upserts into `review_queue` keyed by `(user_id, item_id)`. Items enter the queue when (a) the answer is wrong, OR (b) the answer is right but median in-session latency on that sub-type exceeds the threshold (PRD §4.3 "got right but slowly").

### 9.4 Near-goal computation (PRD §6.3)

`src/server/mastery/near-goal.ts`:

```ts
function deriveNearGoal(input: {
    masteryStates: Map<SubTypeId, MasteryLevel>
    targetDateMs: number | undefined
    nowMs: number
}): string {
    if (input.targetDateMs === undefined) return "Set a target date to see today's goal."
    const remainingSubTypes = [...input.masteryStates.entries()].filter(([, s]) => s !== "mastered").length
    const daysRemaining = Math.max(1, Math.ceil((input.targetDateMs - input.nowMs) / 86_400_000))
    const sessionsPerDay = Math.ceil((remainingSubTypes * 2) / daysRemaining)
    return `${sessionsPerDay} session${sessionsPerDay === 1 ? "" : "s"} today to stay on track.`
}
```

The exact phrasing variants ("ahead", "on track", "behind") are an open question — see §13.

---

## 10. Session flows

The shape of every session is: (NarrowingRamp) → FocusShell → PostSessionReview. Each session type below maps to a route in `src/app/(app)/`.

### 10.1 Diagnostic — `/diagnostic`

Per PRD §4.1. Fires once on first use (first login + no `mastery_state` rows for the user).

1. `(app)/page.tsx` server component reads `mastery_state` rows for the user. If empty, redirects to `/diagnostic`.
2. `/diagnostic/page.tsx` server component calls `startSession({ type: "diagnostic" })`. Skips the NarrowingRamp per PRD §5.3 ("Not used before the diagnostic").
3. `/diagnostic/content.tsx` ("use client") renders `<FocusShell>` with `sessionDurationMs: 50 * 18000 = 900000`, `perQuestionTargetMs: 18000`. The first item is server-rendered.
4. The shell drives `submitAttempt` for each of 50 items; sampling is proportional across the 15 sub-types and across difficulty tiers per PRD §4.1 (logic lives in `getNextItem` for `type === "diagnostic"`).
5. After the 50th submit returns `{ nextItem: undefined }`, the shell calls `endSession` and `router.push(\`/post-session/${sessionId}\`)`.
6. `/post-session/[sessionId]/page.tsx` renders `<PostSessionReview>` (no strategy-review gate per PRD §6.5).
7. After dismiss, route back to `/` which now shows the populated Mastery Map with a recommended first session.

### 10.2 Drill — `/drill/[subTypeId]`

Per PRD §4.4.

1. `/drill/[subTypeId]/page.tsx` renders `<NarrowingRamp>` first (PRD §5.3, default flow with skip link).
2. On `<NarrowingRamp>` complete, `startSession({ type: "drill", subTypeId, timerMode, ifThenPlan })` is invoked.
3. `<FocusShell>` runs with `sessionDurationMs = drillLength * perQuestionTargetMs`. `perQuestionTargetMs` is 18000 for `standard`/`brutal`, 12000 for `speed_ramp`. Drill length defaults to 10 (PRD §4.4).
4. After the last submit, `endSession` then `/post-session/[sessionId]` (no strategy-review gate).

### 10.3 Full-length test — `/test`

Per PRD §4.5. 50 items, 15 minutes, real-test difficulty mix and section interleaving.

1. `/test/page.tsx` renders `<NarrowingRamp>`.
2. `startSession({ type: "full_length", ifThenPlan })`. `getNextItem` pulls from `source: "real"` first (PRD §3.3) and only falls back to `generated` when the real-bank set is exhausted for the requested sub-type/difficulty bucket.
3. `<FocusShell>` with `sessionDurationMs: 900000`, `perQuestionTargetMs: 18000`.
4. After submit-or-timeout, `endSession`. `/post-session/[sessionId]` renders WITH the 30s strategy-review gate (PRD §6.5). Dismiss button is disabled until 30s have elapsed AND `<StrategyReviewGate>` reports the strategy was viewed; `dismissPostSession` enforces this server-side via `ErrStrategyReviewRequired`.

### 10.4 Test-day simulation — `/simulation`

Per PRD §4.6. Identical to full-length except:

- `/simulation/content.tsx` passes a `simulation: true` prop to `<FocusShell>`, which disables any pause UI and any visible question-skip indicators.
- Section ordering matches the real Criteria On-Demand Assessment platform (concrete ordering is an open question — see §13).
- Available from the Mastery Map but is NOT the default Start CTA per PRD §5.2.

### 10.5 Spaced-repetition review — `/review`

Per PRD §4.3.

1. `/review/page.tsx` queries `review_queue` for due items (`due_at_ms <= Date.now()`). If zero rows, redirects back to `/`.
2. `startSession({ type: "review" })`. `getNextItem` returns the due items in `due_at_ms` ascending order.
3. `<FocusShell>` with the standard 18s per-question target.
4. On `submit`, `submitAttempt` calls `scheduleReview` to update `review_queue.due_at_ms` and `interval_days` per the SM-2 ladder.
5. `/post-session/[sessionId]` (no strategy-review gate).

### 10.6 NarrowingRamp orchestration

Lives at `src/components/narrowing-ramp/narrowing-ramp.tsx`. Pure client component that runs four sequential timed steps (PRD §5.3) and then calls a `onComplete(ifThenPlan: string)` prop. Steps:

1. `<ObstacleScan>` — 30s. Picks 3 weak-sub-type options (delivered as a server prop), accepts/edits the if-then plan.
2. `<VisualNarrowing>` — 15s. CSS-only fixation point + slow-moving target; no interaction.
3. `<SessionBrief>` — 15s. Plain-text preview line.
4. `<LaunchCountdown>` — 15s with a 5-second visible countdown at the end (per PRD §5.3 step 4).

### 10.7 Post-session review composition

`/post-session/[sessionId]/page.tsx` (server component) loads:

- The session row.
- All attempts for the session.
- The user's strategies for sub-types where session accuracy was below 70%.
- The wrong items with prompt/options/explanation.

Then renders `<PostSessionReview>` (client) which composes `<WrongItemsList>`, accuracy/latency summary, triage score, surfaced strategies, and — for `full_length` only — the `<StrategyReviewGate>` 30s timer.

---

## 11. Coding conventions checklist

This list is the union of `rules/*.md` and `gritql/*.grit` actually present in this repo. Every checkbox is enforced by either Biome, a GritQL plugin from `biome.json:5-18`, or the `super-lint.ts` pipeline referenced in `package.json:14`.

- [ ] **No `try`/`catch`/`finally`.** Use `errors.try` (async) or `errors.trySync` (sync), with `if (result.error)` on the next line. (`rules/no-try.md`, `gritql/no-try.grit`)
- [ ] **No bare `errors.try` / `errors.trySync`.** Always assign the result; never `void` or `return` it directly. (`gritql/no-try.grit` Cases 4–6)
- [ ] **No `new Error()`.** Use `errors.new()`. (`rules/no-new-error.md`, `gritql/no-new-error.grit`)
- [ ] **No `extends Error`.** Use `errors.new()` sentinels. (`rules/no-extends-error.md`, `gritql/no-extends-error.grit`)
- [ ] **No `instanceof Error`.** Use `errors.is(err, ErrSentinel)`. (`rules/no-instanceof-error.md`, `gritql/no-instanceof-error.grit`)
- [ ] **Every `throw` is preceded by a `logger.{error,warn,info,debug}` call on the immediately preceding line.** (`rules/require-logger-before-throw.md`, `gritql/require-logger-before-throw.grit`)
- [ ] **No `console.*`.** Use `logger` from `@/logger`. (`biome/base.json:24-27` `suspicious/noConsole: error`; `rules/structured-logging.md`)
- [ ] **Logger is object-first, message-string-second.** Message must be a string literal, not a template literal. (`rules/logger-structured-args.md`)
- [ ] **No relative imports.** Use `@/...` aliases everywhere, including same-directory siblings. (`rules/no-relative-imports.md`, `gritql/no-relative-imports.grit`)
- [ ] **No `as` type assertions.** Allowed only for `as const` and the DOM/event types whitelisted in `gritql/no-as-type-assertion.grit`. (`rules/no-as-type-assertion.md`)
- [ ] **No `??` (nullish coalescing).** Fix the source of optionality. (`rules/no-nullish-coalescing.md`, `gritql/no-nullish-coalescing.grit`)
- [ ] **No `||` for fallbacks.** Allowed only as a boolean condition in `if`/`while`/ternary tests. (`rules/no-logical-or-fallback.md`)
- [ ] **No `T | null | undefined` at function boundaries.** Prefer `undefined` (optionals); normalize null at the boundary with `z.preprocess`. (`rules/no-null-undefined-union.md`)
- [ ] **No inline ternaries.** Allowed only when directly assigned to `const`/`let` or in a `return`. (`rules/no-inline-ternary.md`, `gritql/no-inline-ternary.grit`)
- [ ] **No inline `style={{...}}`.** Tailwind classes only; CSS variables via `[--var:value]` syntax. (`rules/no-inline-style.md`, `gritql/no-inline-style.grit`)
- [ ] **No IIFEs.** Define a named function and call it. (`rules/no-iife.md`, `gritql/no-iife.grit`)
- [ ] **No object modules.** Export functions individually; module-level state, not classes. (`rules/no-object-module.md`)
- [ ] **No inline `export`.** Declare without `export`, then `export { ... }` at the bottom. (`rules/no-inline-export.md`; matches the existing pattern at `src/app/page.tsx:28-29` and `src/app/actions.ts:60`)
- [ ] **No arrow functions.** Use `function` declarations. Short inline callbacks tolerated only for trivial array methods. (`rules/no-arrow-functions.md`)
- [ ] **No barrel files.** (`biome/base.json:105` `performance/noBarrelFile: error`) — `src/db/schema.ts` is a permitted barrel because it is the schema-typing collation point used by the Drizzle adapter.
- [ ] **No non-null assertions (`!`).** Validate and throw instead. (`biome/base.json:71-74` `style/noNonNullAssertion: error`; `rules/no-nullish-coalescing.md` §7)
- [ ] **No `process.env`.** Use `env` from `@/env`. (`biome/base.json:70` `style/noProcessEnv: error`)
- [ ] **No `forEach`.** Use `for...of`. (`biome/base.json:34-36` `complexity/noForEach: error`)
- [ ] **No `<img>`.** Use Next `<Image>`. (`biome/base.json:106` `performance/noImgElement: error`)
- [ ] **Unused variables/imports/parameters are errors.** (`biome/base.json:53-56`)
- [ ] **No `timestamp` / `date` / `time` / `interval` columns.** Use `bigint` `_ms`. (`rules/no-timestamp-columns.md`, enforced by `scripts/dev/lint/rules/no-timestamp-columns.ts`)
- [ ] **No `uuid().defaultRandom()`.** Use `default(sql\`uuidv7()\`)`. (`rules/no-uuid-default-random.md`, enforced by `scripts/dev/lint/rules/no-uuid-default-random.ts`)
- [ ] **One table per file** under `src/db/schemas/<domain>/<table>.ts`. (`rules/no-timestamp-columns.md`; pattern at `src/db/schemas/core/todos.ts`)
- [ ] **No implicit `select(*)` / `returning(*)`.** Always pass a column object. (`rules/no-implicit-select-all.md`, `gritql/no-implicit-select-all.grit`)
- [ ] **Prepared statements colocated with the page that uses them**, with type derived via `Awaited<ReturnType<typeof query.execute>>[number]`. (`rules/rsc-data-fetching-patterns.md`; pattern at `src/app/page.tsx:7-17`)
- [ ] **Server components never `async`.** Initiate fetches, pass promises, consume with `React.use()` in client components. (`rules/rsc-data-fetching-patterns.md`)
- [ ] **Mutations are server actions** with `revalidatePath` after writes. (Pattern at `src/app/actions.ts:26`)
- [ ] **Zod uses `safeParse`, never `parse`.** (`rules/zod-usage.md`)
- [ ] **No null/undefined union at boundaries.** (`rules/no-null-undefined-union.md`)

---

## 12. Build order

Sequenced from PRD §9 with concrete file paths. Each step lists the files to create or modify in order.

### Week 1

**Step 1 — Auth + database schema + sub-type config.**
- `src/env.ts` (MOD: add AUTH_*, *_API_KEY)
- `src/auth.ts` (NEW), `src/auth.config.ts` (NEW)
- `src/middleware.ts` (NEW)
- `src/db/lib/pgvector.ts` (NEW)
- `src/db/programs/extensions/pgvector.ts` (NEW); add to `src/db/programs/index.ts:14`
- `src/db/schemas/auth/{users,accounts,auth_sessions,verification_tokens}.ts` (NEW)
- `src/db/schemas/catalog/{sub-types,strategies,items}.ts` (NEW)
- `src/db/schemas/practice/{sessions,attempts,mastery_state}.ts` (NEW)
- `src/db/schemas/review/review_queue.ts` (NEW)
- `src/db/schema.ts` (MOD: extend the barrel)
- `src/config/{sub-types,strategies,admins,item-templates}.ts` (NEW)
- `src/server/auth/admin-gate.ts` (NEW)
- `src/app/api/auth/[...nextauth]/route.ts` (NEW), `src/app/login/page.tsx` (NEW), `src/app/api/health/route.ts` (NEW)
- Manually run `bun db:generate` then `bun db:push` per `README.md` §"Human-led Database Migrations". Seed `sub_types` and `strategies` from the config files via a one-shot script.

**Step 2 — Real-item ingest.**
- `src/server/items/ingest.ts` (NEW), `src/server/items/tagger.ts` (NEW)
- `src/app/(admin)/layout.tsx` (NEW), `src/app/(admin)/ingest/{page,actions}.tsx,ts` (NEW)
- `src/app/api/admin/ingest-item/route.ts` (NEW)
- `src/workflows/embedding-backfill.ts` (NEW), `src/server/generation/embeddings.ts` (NEW)
- Hand-seed ~150 real items via the form per PRD §3.1.

**Step 3 — Focus shell + diagnostic.**
- `src/components/focus-shell/{focus-shell,session-timer-bar,pace-track,question-timer-bar,triage-prompt,inter-question-card,shell-reducer}.tsx,ts` (NEW)
- `src/components/item/{item-prompt,option-button}.tsx` (NEW)
- `src/server/sessions/{queries,start,submit,next,end}.ts` (NEW)
- `src/server/items/queries.ts` (NEW)
- `src/app/(app)/{layout,page,actions}.tsx,ts` (NEW)
- `src/app/(app)/diagnostic/{page,content}.tsx` (NEW)

**Step 4 — Mastery state + Mastery Map.**
- `src/server/mastery/{compute,recompute,near-goal}.ts` (NEW)
- `src/workflows/mastery-recompute.ts` (NEW)
- `src/components/mastery-map/{mastery-map,mastery-icon,near-goal-line,start-session-button}.tsx` (NEW)
- `src/app/(app)/page.tsx` (MOD: renders `<MasteryMap>`)

**Step 5 — Drill mode (standard timer only).**
- `src/app/(app)/drill/[subTypeId]/{page,content}.tsx` (NEW)
- Wire session timer + pace track per PRD §5.1, leaving the question timer toggle for step 8.

### Week 2

**Step 6 — LLM generation pipeline.**
- `src/server/generation/{pipeline,generator,validator,similarity}.ts` (NEW)
- `src/workflows/item-generation.ts` (NEW)
- `src/app/(admin)/generate/{page,actions}.tsx,ts` (NEW), `src/app/api/admin/generate-items/route.ts` (NEW)

**Step 7 — Adaptive difficulty + spaced-repetition.**
- `src/server/sessions/next.ts` (MOD: add `nextDifficultyTier`)
- `src/server/review/{queries,schedule}.ts` (NEW)
- `src/workflows/review-queue-refresh.ts` (NEW)
- `src/app/(app)/review/{page,content}.tsx` (NEW)

**Step 8 — Triage trainer + speed-ramp + brutal + question-timer toggle.**
- `src/components/focus-shell/triage-prompt.tsx` (MOD: full triage logic)
- `src/components/focus-shell/question-timer-bar.tsx` (MOD: toggle + persistence)
- Server action that writes `users.timer_prefs_json` (NEW, in `src/app/(app)/actions.ts`).

**Step 9 — NarrowingRamp + score-to-target + post-session review.**
- `src/components/narrowing-ramp/{narrowing-ramp,obstacle-scan,visual-narrowing,session-brief,launch-countdown}.tsx` (NEW)
- `src/server/narrowing-ramp/obstacle.ts` (NEW)
- `src/components/post-session/{post-session-review,strategy-review-gate,wrong-items-list}.tsx` (NEW)
- `src/app/(app)/post-session/[sessionId]/{page,actions}.tsx,ts` (NEW)

**Step 10 — Strategy library + simulation + history.**
- `src/app/(app)/simulation/{page,content}.tsx` (NEW)
- `src/app/(app)/history/page.tsx` (NEW), `src/app/(app)/history/[sessionId]/page.tsx` (NEW)
- Surface strategies in `<PostSessionReview>` (already wired in step 9).

PRD §9 cuts (if behind): test-day simulation, history detail, NarrowingRamp visual-narrowing step.

---

## 13. Open questions

The PRD does not specify the following. The implementer should make these decisions explicitly rather than introducing silent defaults — flag each with a TODO that names this section and the PRD section it relates to.

1. **Latency thresholds per sub-type** (PRD §2). PRD says "tighter than 18 seconds" but does not give a number per sub-type. The values in §4.1 above (12–18s) are placeholders; final values need product input.
2. **Drill length default per timer mode** (PRD §4.4). PRD says "default 10 questions". Whether `speed_ramp` and `brutal` use the same default is unstated.
3. **Adaptive-difficulty zone widths** (PRD §4.2). PRD says "comfortably under" / "well above". §9.1 above uses 0.8× and 1.2× as placeholders — confirm.
4. **Embedding-similarity threshold for the validator** (PRD §3.2). PRD pins 0.92 cosine; assume "similarity" means `1 - distance` so `distance < 0.08` triggers a rejection.
5. **Quality-score buckets** (PRD §3.2 step 4). The thresholds that map `(promptLength, distractorDistance, optionCount)` to a difficulty estimate are not specified.
6. **Candidate-promotion thresholds** (PRD §3.2 step 6). After 20 attempts, what observed-accuracy/median-latency band promotes vs retires per difficulty tier?
7. **Auth.js bigint adapter shim**. Whether the official `@auth/drizzle-adapter` accepts `bigint` columns directly (with `mode: "number"`) or whether the project needs a thin custom adapter wrapper. See §5.1.
8. **Session-section ordering for `simulation`** (PRD §4.6). "Exact section ordering matching the real Criteria On-Demand Assessment platform" — needs a reference list of which sub-type appears at which question index.
9. **15th abstract sub-type identifier**. PRD §2 lists `abstract.next_in_series`; `docs/CCAT-categories.md:233` lists `abstract.rotation_reflection`. PRD wins by precedence in this spec, but the discrepancy should be resolved in source.
10. **Near-goal phrasing** (PRD §6.3). "Ahead / on-track / behind" wording is an open product-copy decision; §9.4 above gives one phrasing.
11. **Triage shortcut keybinding** (PRD §6.1). "Pressing a configured shortcut" is mentioned but not specified. `Space` is a reasonable default; confirm.
12. **Visibility persistence write cadence**. Per PRD §5.1 timer prefs persist across sessions. Whether to write on every toggle or debounce is unstated.
13. **Candidate-promotion workflow trigger**. PRD §3.2 step 6 mentions it but does not say how it runs. A nightly cron via Vercel is the obvious choice; §8.6 above flags it as out of scope for v1.
14. **Diagnostic question-bank composition**. PRD §4.1 says "samples items proportionally" — the exact split (50 ÷ 15 = 3.33 per sub-type) needs a deterministic rounding rule.
