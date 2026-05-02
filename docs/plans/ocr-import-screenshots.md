# Plan — `scripts/import-screenshots.ts` (OCR import for CCAT screenshots)

One-off batch importer that turns a folder of CCAT question PNGs into rows in the `items` bank by POSTing each screenshot's extracted content through the existing `/api/admin/ingest-item` route. Standalone Bun script. Not part of the app's source tree. Intended to be deleted after the ~300-item import.

Two known input formats live in `data/testbank/`:

- `data/testbank/gauntlet_ccat_practice_1/` — 34 PNGs, ~1326 × 508, one question per image, **answer + explanation visible** in most.
- `data/testbank/12min_prep_practice_1/` — 32 PNGs, ~1330 × 800, one question per image, **answer not visible** in most (need solve + verify).

`data/testbank/` is already in `.gitignore`, so the screenshots themselves never land in the repo.

## What we're building

A single CLI:

```bash
bun run scripts/import-screenshots.ts <inbox-dir> [--dry-run] [--limit N] [--skip-solve]
```

Per image, in order:

1. **Idempotency** — SHA-256 the file bytes, look it up in `scripts/_logs/imported.jsonl`, skip if already imported.
2. **Extract** — Sonnet vision call. Returns the structured object below or fails.
3. **Skip non-text-only** — drop anything where `isTextOnly === false`.
4. **Branch on `answerVisible`**:
   - `true` — trust the screenshot, use its `correctAnswer` + `explanation`.
   - `false` and `--skip-solve` not set — run **solve** (Sonnet text), then **verify** (Sonnet, fresh context). Drop on disagreement.
   - `false` and `--skip-solve` set — log to skipped and continue.
5. **POST** — `POST http://localhost:3000/api/admin/ingest-item` with `Authorization: Bearer ${CRON_SECRET}`. Body matches `requestSchema` in `src/app/api/admin/ingest-item/route.ts`.
6. **Log** outcome to one of the JSONL files under `scripts/_logs/`.

End-of-run summary printed to stdout.

## Files created

| Path | Purpose |
| --- | --- |
| `scripts/import-screenshots.ts` | The script. |
| `scripts/_logs/.gitkeep` | Keeps the directory in the repo, contents are gitignored. |
| `docs/plans/ocr-import-screenshots.md` | This plan. |

Files modified:

- `.gitignore` — append `scripts/_logs/*.jsonl` (the `.gitkeep` stays tracked).

`scripts/` already exists (it holds `scripts/dev/` for fmt/lint/style + `scripts/question_screenshots_to_pdf.py`). No need to create it.

## Dependencies

No new packages. The repo already has:

- `@anthropic-ai/sdk` `0.92.0` — used today by `src/server/items/tagger.ts`.
- `zod` `^4.3.6`.

`sharp` is **not** installed and we don't need it. The Anthropic SDK accepts base64 PNG directly via `{ type: "image", source: { type: "base64", media_type: "image/png", data } }`. The screenshots are ~100KB and well under the 5MB-per-image API limit.

Bun loads `.env` automatically per `CLAUDE.md`, so `Bun.env.ANTHROPIC_API_KEY` and `Bun.env.CRON_SECRET` work without `dotenv`.

## Style exemption (header comment)

The script lives outside `src/`. The Superbuilder ruleset (Pino logger, `errors.try`, no `as`, no `try/catch`, no `console.log`, etc.) does **not** apply. The script uses `console.log` for progress, native `try/catch` where it reads cleaner than `errors.trySync`, and inline ternaries freely. The first lines of the file say so:

```ts
// scripts/import-screenshots.ts
//
// One-off OCR import pipeline for CCAT question screenshots.
//
// EXEMPT FROM THE PROJECT RULESET. This file is a standalone Bun script,
// not part of the app source tree. It uses console.log, native try/catch,
// and other patterns banned in src/. Do not copy idioms from this file
// into src/.
//
// Intended lifecycle: run once against ~300 screenshots in data/testbank/,
// then delete (along with scripts/_logs/) once the items bank is populated.
```

Biome and the GritQL plugins ignore `scripts/` already (they target `src/`), so there's nothing to opt out of in tooling config.

## Imports the script will pull from `src/`

- `import { subTypes, subTypeIds, type SubTypeId, type Difficulty } from "@/config/sub-types"` — single source of truth for the 11 v1 sub-types and difficulty levels. This file is pure (no DB pool, no env reads), so importing it from a script does not trigger Next.js init or open a Postgres connection.

That's the only `@/`-aliased import. Everything else (the request shape, the model id constant) is duplicated locally in the script — a script-shaped redundancy, not a refactor target.

The script does **not** import `@/db`, `@/server/items/ingest`, or anything that would pull in the Drizzle pool, the workflow runtime, or the T3 env wrapper. It hits the running dev server's HTTP endpoint instead.

## CLI argument parsing

`Bun.argv.slice(2)`, hand-rolled:

- `<inbox-dir>` — required positional. Resolved via `path.resolve()`. Must exist and be a directory; otherwise exit 1 with a message.
- `--dry-run` — extract (and solve/verify if needed) and log to stdout, do **not** POST.
- `--limit N` — stop after N images. Useful for `--limit 5 --dry-run` sampling.
- `--skip-solve` — when `answerVisible === false`, log to skipped and continue (don't run solve+verify, don't POST).

Files in the inbox are sorted lexicographically (so `q01.png` before `q02.png`) and filtered to `.png` (case-insensitive). Other extensions are ignored with a one-line note.

## Pipeline detail

### 1. Idempotency

```
hash = sha256(file bytes)        // crypto.createHash, ~5ms per ~100KB image
if hash ∈ imported.jsonl:
    log skip(reason="already imported", hash, filePath) to stdout
    continue
```

`imported.jsonl` is read once at startup into an in-memory `Set<string>` of hashes for O(1) lookup. New successful imports are appended to the same file as the run progresses, so a re-run after a crash resumes cleanly.

### 2. Extract — Sonnet 4.6 vision

Single message with image + instructions. Model id constant: `EXTRACT_MODEL = "claude-sonnet-4-6"`. Max tokens 1024, temperature 0.

The extracted shape is validated by this Zod schema:

```ts
const extractedItem = z.object({
    isTextOnly: z.boolean(),
    question: z.string().min(1),
    options: z.array(
        z.object({
            id: z.enum(["A", "B", "C", "D", "E"]),
            text: z.string().min(1)
        })
    ).min(2).max(5),
    answerVisible: z.boolean(),
    correctAnswer: z.enum(["A", "B", "C", "D", "E"]).optional(),
    explanationVisible: z.boolean(),
    explanation: z.string().min(1).optional(),
    subTypeId: z.enum(subTypeIds),
    difficulty: z.enum(["easy", "medium", "hard", "brutal"])
}).refine(d => !d.answerVisible || d.correctAnswer !== undefined,
          { message: "answerVisible=true but correctAnswer missing" })
  .refine(d => !d.explanationVisible || d.explanation !== undefined,
          { message: "explanationVisible=true but explanation missing" })
```

Pre-parse: strip markdown fences with the same regex `src/server/items/tagger.ts` already uses (`/^\s*\`\`\`(?:json)?\s*\n?([\s\S]*?)\n?\`\`\`\s*$/`). On `safeParse` failure or non-JSON output, append to `extract-failures.jsonl` and continue to the next image.

### 3. Skip non-text-only

If `isTextOnly === false` (any answer choice is a chart, shape, or image), append to `skipped.jsonl` with `reason: "visual content"` and continue. v1 of the items bank is text-only by design (see `architecture_plan.md` and `body-schema.ts`).

### 4a. Visible-answer branch

`answerVisible === true`. Use `correctAnswer` and (if `explanationVisible`) `explanation` directly. If `answerVisible` but **not** `explanationVisible`, ingest with `explanation` omitted — the route schema makes it optional.

`source: "ocr-visible"`.

### 4b. Solve branch

`answerVisible === false` and `--skip-solve` not set.

**Solve** — Sonnet 4.6 text-only call. Returns:

```ts
const solverOutput = z.object({
    correctAnswer: z.enum(["A", "B", "C", "D", "E"]),
    explanation: z.string().min(1),
    confidence: z.number().int().min(1).max(5)
})
```

The solver's explanation is meant to be the kind of 1-3 sentence "fastest path to the answer" framing that a CCAT taker would read **after** the question, in review mode — not a verbose proof. The user has 18 seconds in real practice; the explanation is for sanity-checking, not pedagogy.

**Verify** — Sonnet 4.6 text-only call in a **fresh conversation** (separate `messages.create` call, not a continuation). The verifier is told to solve independently first, then read the solver's claim and either confirm it or report what they got. Returns:

```ts
const verifierOutput = z.object({
    agrees: z.boolean(),
    correctIfDisagree: z.enum(["A", "B", "C", "D", "E"]).optional(),
    reason: z.string().min(1).optional()
})
```

If `agrees === false`, append the question, the solver's claim, and the verifier's response to `needs-review.jsonl` and continue without ingesting. The user reviews these manually after the run.

If `agrees === true`, ingest with `source: "ocr-solved"`.

### 5. POST to ingest

Single `fetch` to `http://localhost:3000/api/admin/ingest-item`:

```ts
{
  method: "POST",
  headers: {
    "Authorization": `Bearer ${Bun.env.CRON_SECRET}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    subTypeId,                  // SubTypeId
    difficulty,                 // "easy"|"medium"|"hard"|"brutal"
    body: { kind: "text", text: question },
    options,                    // [{ id: "A", text }, ...]
    correctAnswer,              // "A"|"B"|...
    explanation                 // optional string
    // strategyId not used — the route makes it optional
  })
}
```

Expected success: `201 { itemId: <uuid> }`. The route also kicks off the embedding-backfill workflow internally (`src/server/items/ingest.ts` calls `start(embeddingBackfillWorkflow, ...)`); the script doesn't need to do anything for that.

On any non-2xx, append the response status, response body, and the request body (sans the auth header) to `ingest-failures.jsonl` and continue.

The route currently authenticates via `Bearer ${env.CRON_SECRET}` (see `src/app/api/admin/ingest-item/route.ts`). There's a TODO in that file to introduce a dedicated `ADMIN_API_TOKEN`; we are intentionally **not** doing that as part of this script — out of scope.

### 6. Log success

Append one line to `imported.jsonl`:

```json
{"timestamp":"2026-05-02T16:00:00.000Z","filePath":"data/testbank/gauntlet_ccat_practice_1/q01.png","hash":"sha256:abcd…","itemId":"01928f1a-…","subTypeId":"verbal.synonyms","difficulty":"easy","source":"ocr-visible"}
```

`source` is one of `"ocr-visible"` or `"ocr-solved"`.

## Rate limit and backoff

A single in-process throttle: between any two outbound requests (extract, solve, verify, **and** the local ingest POST) wait until 1 second has elapsed since the previous request's start. Implemented with one `lastRequestStartMs` variable and `await Bun.sleep(...)`.

This is conservative — the local ingest POST doesn't strictly need to share the budget with the Anthropic API — but it keeps the dev server's logs readable and the script trivially correct.

On a `429` response from Anthropic, retry with exponential backoff: `1s`, `2s`, `4s`. After the third failure, append to `extract-failures.jsonl` (or the appropriate file) and continue. We do **not** retry the local ingest POST on 5xx — those are dev-server bugs and should be visible, not papered over.

## End-of-run summary

Format matches the user's spec exactly (right-aligned numbers, single space before colons preserved):

```
Total files:           312
Already imported:       45
Skipped (visual):       12
Skipped (no-solve):      0
Extract failures:        3
Ingest failures:         1
Needs review:            8
Successfully ingested: 243
  - from visible answer: 180
  - from solve+verify:    63
```

Counters are kept in a plain object during the run; printed in `finally` so a Ctrl-C still surfaces partial progress.

## Draft prompts

These are pasted here for review **before** implementation. The user is expected to redline these in the plan, then I implement them verbatim into `scripts/import-screenshots.ts`. Any change between this plan and the final prompts will be called out explicitly when I report back after the build.

The shared sub-type list is generated at runtime from `subTypes` in `src/config/sub-types.ts` so the prompts can never drift from the source of truth. The string `${SUB_TYPE_LIST}` below is the placeholder; at runtime it expands to:

```
- verbal.synonyms — Synonyms (section: verbal)
- verbal.antonyms — Antonyms (section: verbal)
- verbal.analogies — Analogies (section: verbal)
- verbal.sentence_completion — Sentence Completion (section: verbal)
- verbal.logic — Verbal Logic (section: verbal)
- numerical.number_series — Number Series (section: numerical)
- numerical.letter_series — Letter Series (section: numerical)
- numerical.word_problems — Word Problems (section: numerical)
- numerical.fractions — Fractions (section: numerical)
- numerical.percentages — Percentages (section: numerical)
- numerical.averages_ratios — Averages & Ratios (section: numerical)
```

### Extract prompt (Sonnet 4.6, vision)

System:

```
You are an OCR + classification helper for CCAT (Criteria Cognitive Aptitude Test) practice screenshots. You will be shown one screenshot at a time, each containing one multiple-choice question.

Your job is to extract the question's structured content and classify it into one of the 11 v1 sub-types.

Sub-types (id — display name (section)):
${SUB_TYPE_LIST}

Difficulty levels: "easy" (under 8s), "medium" (8–14s), "hard" (14–18s), "brutal" (over 18s). Estimate from the question's complexity, not the source label on the screenshot (which is often missing or unreliable).

Important conventions of CCAT screenshots:
- Some screenshots show the correct answer (a green checkmark, a highlighted option, a "Correct answer: X" line, or a "✓" next to one option). When you see one, set "answerVisible": true and put the option letter in "correctAnswer".
- Some screenshots show a written explanation below the question, typically titled "Explanation", "Solution", or similar. When present, set "explanationVisible": true and copy the explanation text verbatim into "explanation".
- If neither is shown, set both flags to false and omit "correctAnswer" and "explanation".
- Synonyms/antonyms questions in the CCAT convention put the target word in ALL CAPS (e.g. "Choose the word that most nearly means HAPPY.").
- Set "isTextOnly": false if ANY of the answer choices is a chart, shape, image, or visual diagram. Set it true only if the entire question and every option is plain text.

Respond with raw JSON only — no markdown code fences, no commentary, just the object. Use this exact shape:

{
  "isTextOnly": <bool>,
  "question": <string, the prompt text verbatim>,
  "options": [{ "id": "A"|"B"|"C"|"D"|"E", "text": <string> }, ...],
  "answerVisible": <bool>,
  "correctAnswer": "A"|"B"|"C"|"D"|"E",      // only if answerVisible
  "explanationVisible": <bool>,
  "explanation": <string>,                    // only if explanationVisible (verbatim from screenshot)
  "subTypeId": <one of the 11 ids above>,
  "difficulty": "easy"|"medium"|"hard"|"brutal"
}
```

User content: `[{ type: "image", source: { type: "base64", media_type: "image/png", data: <b64> } }, { type: "text", text: "Extract this CCAT question." }]`.

### Solve prompt (Sonnet 4.6, text only)

System:

```
You are solving a single CCAT (Criteria Cognitive Aptitude Test) multiple-choice question. The user has 18 seconds per question on the real test, so your explanation should describe the FASTEST path to the answer in 1–3 sentences — not a verbose proof. The explanation is shown to the user during post-session review, after they have already answered, so it is for sanity-checking and pattern reinforcement.

Respond with raw JSON only — no markdown code fences, no commentary, just the object:

{
  "correctAnswer": "A"|"B"|"C"|"D"|"E",
  "explanation": <1–3 sentence string framing the fastest path>,
  "confidence": <integer 1–5, where 5 = certain and 1 = guess>
}
```

User:

```
Question:
<question>

Options:
A. <option A text>
B. <option B text>
C. <option C text>
D. <option D text>
[E. <option E text>  -- only if 5 options]
```

### Verify prompt (Sonnet 4.6, text only, FRESH CONVERSATION)

System:

```
You are an independent verifier for CCAT (Criteria Cognitive Aptitude Test) answers. You will be given a question, the answer options, and another solver's claimed answer + reasoning.

Your protocol:
1. Solve the question yourself first, BEFORE looking at the claim. Pick the option you would choose.
2. Then read the claim. If the claim's answer matches yours AND the claim's reasoning is sound (no obvious errors), set "agrees": true.
3. If the claim's answer does not match yours, set "agrees": false, put your answer in "correctIfDisagree", and explain the discrepancy in "reason" in 1–2 sentences.
4. If the claim's answer matches yours but its reasoning has a clear error (e.g. arithmetic mistake masked by a coincidentally correct option), set "agrees": false and explain in "reason".

Respond with raw JSON only — no markdown code fences, no commentary, just the object:

{
  "agrees": <bool>,
  "correctIfDisagree": "A"|"B"|"C"|"D"|"E",  // only if agrees=false
  "reason": <string>                          // only if agrees=false
}
```

User:

```
Question:
<question>

Options:
A. <option A text>
B. <option B text>
C. <option C text>
D. <option D text>
[E. <option E text>]

Claimed answer: <X>
Claimed reasoning: <solver's explanation verbatim>
```

The verifier call uses a brand-new `messages` array (no chained context from the solver call). This is structural, not a prompt-engineered "you have no memory" trick — the SDK call is genuinely a separate request.

## Logging files (under `scripts/_logs/`)

Every line in every file is one JSON object. Append-only. Read on next run only for `imported.jsonl` (idempotency).

| File | Purpose | Schema |
| --- | --- | --- |
| `imported.jsonl` | Successful ingestions, source of idempotency. | `{timestamp, filePath, hash, itemId, subTypeId, difficulty, source}` |
| `skipped.jsonl` | Intentional skips. | `{timestamp, filePath, hash, reason, …extra}` (`reason ∈ {"already imported", "visual content", "needs solve, --skip-solve set"}`) |
| `extract-failures.jsonl` | Vision call failed, JSON parse failed, or Zod validation failed. | `{timestamp, filePath, hash, stage: "extract", rawOutput, error}` |
| `needs-review.jsonl` | Solver and verifier disagreed. | `{timestamp, filePath, hash, question, options, solver: {answer, explanation, confidence}, verifier: {…}}` |
| `ingest-failures.jsonl` | Local POST returned non-2xx. | `{timestamp, filePath, hash, status, responseBody, requestBody}` |
| `.gitkeep` | Tracked. Keeps the dir in the repo. | (empty) |

`scripts/_logs/*.jsonl` is added to `.gitignore` so the run artefacts never land in commits.

## Test plan

The user said the script doesn't need automated tests. Sanity-checking is by dry-run.

Suggested test commands, in order:

1. **Dry run, 5 from the answer-visible source:**
   ```bash
   bun run scripts/import-screenshots.ts data/testbank/gauntlet_ccat_practice_1 --dry-run --limit 5
   ```
   Expected: 5 extractions printed to stdout, all `isTextOnly: true` (these are CCAT verbal/numerical text questions), most with `answerVisible: true`. No POSTs, no log files written (dry-run).

2. **Dry run, 5 from the answer-not-visible source:**
   ```bash
   bun run scripts/import-screenshots.ts data/testbank/12min_prep_practice_1 --dry-run --limit 5
   ```
   Expected: 5 extractions, most with `answerVisible: false`, each followed by a solve + verify pair. Stdout shows the solver's answer + the verifier's `agrees` result. No POSTs.

3. **Dry run, `--skip-solve` on the no-answer source:**
   ```bash
   bun run scripts/import-screenshots.ts data/testbank/12min_prep_practice_1 --dry-run --limit 5 --skip-solve
   ```
   Expected: 5 extractions, no solve calls fired, all logged as "needs solve, --skip-solve set" (in dry-run, this means stdout-only).

The user reviews:
- The drafted prompts in this plan.
- The dry-run JSON for items 1–5 from each source.
- The verifier's reasoning on a couple of solve-branch examples.

Once those pass review, the user runs without `--dry-run` against both directories.

## Out of scope

- A dedicated `ADMIN_API_TOKEN` env var (the route's TODO). The script reuses `CRON_SECRET` per the existing convention.
- A web UI for the `needs-review.jsonl` items. The user reviews them by hand against the source PNG.
- Re-running ingest on items that succeeded but later need their explanation rewritten — this is a one-shot pipeline; corrections are a separate manual loop against the admin form.
- Parallelism. We hit the 1 req/s rate limit anyway; serial keeps the code 50 lines shorter and the logs in order.
- Image preprocessing (cropping, resizing). The Anthropic SDK accepts the raw PNG; if extraction quality turns out to be bad, that's a prompt issue, not an image issue.

## Cleanup (post-import)

Once all ~300 items are ingested and verified in the bank:

1. Manually review `needs-review.jsonl` and either ingest the corrected versions through the admin form or accept the loss.
2. `git rm scripts/import-screenshots.ts`.
3. `rm -rf scripts/_logs/` (the directory is gitignored anyway except for `.gitkeep`).
4. Revert the `.gitignore` line for `scripts/_logs/*.jsonl`.
5. Remove this plan document, or move it to `docs/claude_logs/` as a session record.

## Open questions

1. **Question screenshots that show "Correct: B" but no explanation** — these should be ingested with `explanation` omitted (the route schema allows that). The plan does this; flagging here in case the user prefers to run them through the solve branch instead to backfill explanations.
2. **Difficulty estimation.** The screenshots may not visibly indicate difficulty. The extract prompt asks Sonnet to estimate from question complexity. There's no calibration against the live `latencyThresholdMs` thresholds — for v1 ingestion this is fine; mastery rebalancing happens off latency in production.
