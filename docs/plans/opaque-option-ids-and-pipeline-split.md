# Plan — Opaque option ids + OCR pipeline split

Two coupled architectural changes to land before more OCR imports run. The opaque-option-ids change replaces the today's `id: "A"|"B"|"C"|"D"|"E"` shape with server-generated short random strings; the pipeline-split change separates `scripts/import-screenshots.ts` into a stage-1 question-extraction script, a stage-2 explanation-generation script, and a stage-3 regeneration script.

This plan partially supersedes `docs/plans/ocr-import-screenshots.md`. Where the two conflict, this one wins. The OCR plan's substantive design (idempotency model, the four-pass LLM contract, the structured-explanation contract, the canonical 5-image dry-run) carries forward unchanged; only the script topology and the option-id shape change.

## 1. Why both changes, why now

**The pipeline split alone doesn't justify the schema work.** Splitting `import-screenshots.ts` into stages is a code-organization improvement; it doesn't move the architecture forward. **The schema migration alone is technically deferrable.** Letter ids work fine today and could keep working until the click-to-highlight or shuffle features actually need opaque ids. Either change in isolation is "nice to have."

**Together they are a single coherent move.** The OCR pipeline is currently emitting items into the bank under the old letter-id shape; every additional OCR run extends the surface that any future migration has to touch. The split is the natural moment to introduce the new ingest-side scripts, and those scripts are the natural place to emit the new id shape from day one. Doing the schema change later — after a few hundred OCR-imported items — means migrating a moving target. Doing the pipeline split later — after the schema change has shipped — means writing the new option-id-aware code into a script we already plan to delete. The combined sequence (schema first, scripts second, both before the next OCR run) is the only ordering where neither change retreads work.

The motivating future use cases for opaque ids — Phase 5/6 click-to-highlight (where a future renderer reads `referencedOptions` from `metadata_json.structuredExplanation` and maps opaque ids to current display positions to render tappable spans) and per-session option shuffling (where the same item shows options in different orders across sessions to defeat memorization) — are the reasons to do this at all. Their timelines are not committed by this plan; the architecture is ready when they ship.

## 2. Opaque option ids — design

### 2.1 Choice of id format

Three reasonable options were considered:

- **UUIDv7** — project default for primary keys; pgcrypto available; ~36 chars; matches `items.id` shape. Overkill for an in-row reference: option ids are scoped to a single item's `options_json` array, never cross-referenced from another row, never indexed. The 36-char overhead bloats every item's JSON without buying anything UUIDv7's time-sortable prefix would help with.
- **Short content-hash** (first 12 chars of SHA-256 of option text) — deterministic; ~12 chars; cute. Collides when two items genuinely have identical option text — and they do: a numerical "120" appears as an option across many percentage-of-whole and word-problem items, the literal word "joyful" appears in many synonym items. Collisions inside a single item's options would be rare but not impossible (two seemingly-distinct distractors could compute to the same hash); collisions across items don't matter for storage but break any debugging assumption that an id is a stable handle.
- **Short random string** (8 chars from a base32 alphabet, generated via `crypto.randomBytes`) — ~8 chars; collision probability negligible at the within-item scope (5 ids drawn from 32^8 = ~10^12); no semantic content; renders cleanly in dev tools.

**Recommendation: short random string, 8 chars from `Crockford's base32` (digits + lowercase consonants minus i/l/o/u to avoid visual ambiguity).** Generated server-side via Bun's built-in `crypto.randomBytes(5)` → base32-encode → take first 8 chars. The full helper:

```ts
import { randomBytes } from "node:crypto"
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"  // Crockford's base32
function generateOptionId(): string {
    const bytes = randomBytes(5)
    let out = ""
    for (let i = 0; i < 8; i++) {
        out += ALPHABET[bytes[i % 5] >> ((i % 2) * 3) & 31]
    }
    return out
}
```

Lives in a new `src/server/items/option-id.ts` (single helper, single export). Used by the ingest path and the migration script; no other callers.

Example option after migration: `{ id: "k7m3n9px", text: "joyful" }`.

### 2.2 Where ids are generated

**Server-side at ingest time, exclusively.** The OCR script's extract pass returns options *without* ids — the LLM never sees opaque ids in extract because (a) generating them client-side risks LLM-invented collisions or letter-shaped fallbacks, (b) the extract prompt is simpler when it returns `options: [{ text }, ...]` with no id concept, and (c) the assignment happens once, server-side, in the path that owns the database row.

The explain pass *does* see opaque ids — by then the ingest path has assigned them, and the explain prompt needs the ids to populate `referencedOptions`. This is the core insight that makes the pipeline-split design clean: stage 1 outputs JSON with options that already have opaque ids (assigned at the boundary between extract and stage-1 emission), and stage 2's explain pass consumes those ids unchanged.

The Phase 4 LLM generation pipeline (`src/config/item-templates.ts`'s `generatedItem` Zod schema, currently asks the LLM to invent option ids like 'a','b','c','d') changes the same way: drop ids from the LLM-facing schema, generate them server-side at the post-validation step. The user-facing prompt at `src/config/item-templates.ts:38` (*"Provide between 4 and 5 options, each with a unique short id (e.g. 'a','b','c','d')"*) gets rewritten to say "provide each option with just its text; the system will assign ids."

### 2.3 Schema impact

`items.options_json` stays `jsonb` — no column-level migration. Only the JSON shape inside the column changes, and the validation layer is the source of truth for the new shape.

Files that need validation updates:

| File | Line | Change |
|---|---|---|
| `src/server/items/ingest.ts:13` | `optionSchema` | `id` constraint widens to opaque-id pattern (8 chars, base32 alphabet). The `correctAnswer` check at line 102 still works as-is — it's a string-set lookup. The duplicate-id check at line 95 still works. |
| `src/server/items/ingest.ts:18` | `ingestInput` | No structural change — `options` array still typed as `optionSchema[]`, `correctAnswer` still a string. The semantics shift: callers must now pass options that already have opaque ids assigned, OR a new wrapper function does the assignment. Recommended: a new helper `assignOptionIds(options)` lives in `src/server/items/option-id.ts` and is called by both the ingest route and the OCR script before invoking `ingestRealItem`. |
| `src/app/api/admin/ingest-item/route.ts:19` | `requestSchema.options` | Same as `optionSchema` widening. The route accepts what stage 2 sends. |
| `src/app/api/admin/ingest-item/route.ts:27` | `requestSchema.correctAnswer` | No change. |
| `src/app/api/admin/ingest-item/route.ts:32` | `requestSchema.metadata.structuredExplanation.parts[].referencedOptions` | Drop the `z.enum(["A","B","C","D","E"])` — `referencedOptions` becomes `z.array(z.string())` (any opaque id present in the item's options array). The route's existing `.refine()` for parts ordering stays as-is. |
| `src/server/items/ingest.ts:23` (the corresponding `structuredExplanation` schema in ingest.ts) | Same `z.enum(["A","B","C","D","E"])` → `z.array(z.string())` change. |
| `scripts/import-screenshots.ts:136` (`structuredExplanationOutput`) | Same. |
| `scripts/import-screenshots.ts:85` (`optionLetter`) | Drop. The script's `extractedItem` schema's `options[].id` becomes a string, OR the extract phase stops returning ids entirely (recommended; see §2.2). |
| `scripts/import-screenshots.ts` (`EXTRACT_TOOL.input_schema`) | Drop the `id` field's `enum: ["A","B","C","D","E"]`; either drop the `id` field entirely from the tool input_schema (recommended, matches the "extract returns no ids" decision) or widen the type to `string`. |
| `src/config/item-templates.ts:11` (`Option`) | `id` field dropped from the LLM-facing schema. Server assigns post-validation. |
| `src/config/item-templates.ts:38` | Prompt text rewrite to remove the "provide each option with a unique short id" instruction. |

The plan-prompt mentioned `src/server/items/body-schema.ts` as a possible touch point. Inspected — it does NOT touch options. Only `body` (the question prompt). No change needed there.

### 2.4 Display path

Today, `src/components/item/option-button.tsx:23` renders `<span>{id}.</span>` — the `id` IS the display label. Under opaque ids, the displayed letter must come from position-in-array.

**Recommended change shape** (no code in this plan, just the seam):

- `OptionButton`'s `OptionButtonProps` gains a `displayLabel: string` prop. The component renders `<span>{displayLabel}.</span>` instead of `<span>{id}.</span>`. The `id` prop stays on `OptionButton` only as a stable React `key` and to identify the option in callbacks; it's never displayed.
- `ItemPrompt` (`src/components/item/item-prompt.tsx:60`) computes `displayLabel` for each option as `String.fromCharCode("A".charCodeAt(0) + index)` and passes it to `OptionButton`. Position-in-array is the source of truth.
- The keyboard-nav handler at `src/components/item/item-prompt.tsx:81` (`optionIndexForKey`) is **already position-keyed** — `key "A"` already maps to `index 0` and looks up `optionsRef.current[index]`. No change needed there. This is a nice property of the existing implementation: it accidentally pre-supported opaque ids.

For `selectedOptionId` comparisons (`src/components/item/item-prompt.tsx:65`) and `onSelect(option.id)` callbacks (line 67), the opaque id flows through unchanged. The downstream consumers (`<FocusShell>`, `submitAttempt` server action) compare opaque ids against `correctAnswer` — both are opaque after migration, so equality works.

### 2.5 Backward compatibility

None at the API or wire level — everything is server-controlled. The change is invisible to clients.

But existing rows in the bank need migrating:
- 55 hand-seeded items (11 sub-types × 5 each, in `src/db/seeds/items/data/`).
- Any items the OCR pipeline has imported by the time this change ships.

See §3 for the migration playbook.

## 3. Opaque option ids — migration

### 3.1 What needs migrating

Three fields per item, in lockstep:

1. `options_json[i].id` — letter → opaque id.
2. `correct_answer` — letter → opaque id (must match one of the new ids assigned in field 1).
3. `metadata_json.structuredExplanation.parts[].referencedOptions[]` — array of letters → array of opaque ids (where the field exists; only items ingested via the OCR pipeline have it).

### 3.2 Migration approach

**A one-shot Bun script: `scripts/migrate-opaque-option-ids.ts`.**

For each item row:

1. Read `options_json`, `correct_answer`, `metadata_json`.
2. Detect already-migrated items by inspecting `options_json[0].id` — if it is a single uppercase letter A-E, migrate; otherwise skip and log "already migrated."
3. Generate a new opaque id for each option using the helper from §2.1.
4. Build a per-item map `letterToOpaque = { "A": "k7m3n9px", "B": "g4qx2vmt", ... }`.
5. Rewrite `options_json[i].id` using the map.
6. Rewrite `correct_answer` using the map (must exist in the map; if it doesn't, log to a failures file and skip the item — the row is already malformed).
7. If `metadata_json.structuredExplanation` exists, rewrite each part's `referencedOptions` array element-wise via the map.
8. Write all three updates in a single Drizzle transaction per item.
9. Append the per-item map plus the row's `id` to `scripts/_logs/migrate-opaque-ids.jsonl` BEFORE the transaction commits — this is the rollback artifact (see §3.4).

**Idempotency:** detected at step 2. Re-running the script after a partial run is safe.

**Logging:** one JSON object per row, fields `{ timestamp, itemId, oldOptions: [...], newOptions: [...], letterToOpaque: {...}, status: "migrated" | "skipped-already-migrated" | "failed" | "skipped-malformed" }`. Failures are logged but don't halt the script — the run continues and the failure log is the post-run punch list.

**The script does NOT use `ingestRealItem`.** It directly UPDATEs rows via Drizzle. No embedding-backfill workflow re-trigger, no validation through the main ingest path. The data stays the same; only the option-id encoding changes. The structured explanation Zod refinement in `ingest.ts` would also need to accept both shapes during the migration window — see §3.3.

### 3.3 Order of operations

The migration is bracketed by two validation-tightening commits:

1. **Soften validation (commit A).** Update Zod schemas in `src/server/items/ingest.ts`, `src/app/api/admin/ingest-item/route.ts`, and `scripts/import-screenshots.ts` to accept BOTH old (`A-E`) and new (8-char base32) option-id shapes. Specifically:
   - `optionSchema.id` widens from "any string min 1 max 64" (current) to a regex that matches either letter or opaque shape — practically, just keep it `z.string().min(1).max(64)` since it already accepts both.
   - `referencedOptions` widens from `z.enum(["A","B","C","D","E"])` to `z.array(z.string())`.
   - These changes go in BEFORE the migration runs. After this commit, the system tolerates either shape. No data has changed yet.

2. **Run the migration (out-of-band, no code commit).** Run `bun run scripts/migrate-opaque-option-ids.ts` against the dev database. Verify via SQL spot-checks that all items now have opaque ids, that `correct_answer` exists in the new options array, and that `referencedOptions` arrays only contain opaque ids. Inspect `migrate-opaque-ids.jsonl` for failures.

3. **Tighten validation (commit B).** Update the same Zod schemas to REJECT the old letter shape. This catches future regressions — if any code path tries to ingest a letter id, it fails loudly. Specifically:
   - `optionSchema.id` constraint becomes `z.string().regex(/^[0-9a-z]{8}$/)` (matches the opaque format from §2.1; the regex excludes uppercase so letter ids are impossible to slip through).
   - `referencedOptions` constraint stays `z.array(z.string())` — there's no clean regex check for "this string matches one of the item's option ids" in Zod alone, but the `ingestRealItem` runtime check at line 102 (`if (!optionIds.has(data.correctAnswer))`) extends naturally to validate `referencedOptions` too.

The bracketing is the load-bearing pattern. At no point during the migration is the validation layer inconsistent with what's in the DB.

### 3.4 Rollback

The migration script's log file (`scripts/_logs/migrate-opaque-ids.jsonl`) contains the full per-item id map. To roll back:

1. Read each line of the log.
2. Build the inverse map: `opaqueToLetter = { "k7m3n9px": "A", ... }` per item.
3. Rewrite `options_json[i].id`, `correct_answer`, and `referencedOptions[]` back to letters.
4. Run as the same Drizzle transaction-per-item shape as the forward migration.

This is a one-off rollback script that doesn't need to ship in the same commit. If rollback ever happens, it's written then. Documenting the log shape here is the forward investment.

### 3.5 Existing OCR-imported items

If any OCR runs have completed before this migration lands, those items have the old letter-id shape (since today's `import-screenshots.ts` hardcodes `A-E`). They go through the migration script unchanged — the script is data-driven, not source-aware. `metadata_json.importSource` continues to indicate provenance; the migration adds nothing to it.

The same script handles future re-runs in case someone manually loads more letter-id items into the bank.

## 4. OCR pipeline split — design

### 4.1 Stage boundaries

**Stage 1 — `scripts/import-questions.ts`.** Per image: idempotency check (SHA-256 of file bytes against `imported.jsonl` — but see §4.4 for the new layered idempotency), extract via Sonnet vision, isTextOnly check, branch on `answerVisible` (use screenshot answer OR run solve+verify). Emits one JSON file per successful image to `scripts/_stage1/<source-dir-name>/<original-filename>.json`. Logs failures and skips to the existing JSONL files (`extract-failures.jsonl`, `needs-review.jsonl`, `skipped.jsonl`) plus a new `stage1-complete.jsonl` (see §5.3). Does NOT call the explain pass. Does NOT POST.

**Stage 2 — `scripts/generate-explanations.ts`.** Walks `scripts/_stage1/` recursively. For each JSON file: idempotency check (source-image hash against `imported.jsonl`), call the explain pass (writes `parts` referencing the stage-1 opaque option ids directly), POST to `http://localhost:3000/api/admin/ingest-item`, append to `imported.jsonl`. Logs failures to `explanation-failures.jsonl` and `ingest-failures.jsonl`.

**Stage 3 — `scripts/regenerate-explanations.ts`.** Reads existing items directly from the database via Drizzle (this script is the only one with DB access — stages 1 and 2 hit the HTTP route). For each item matching the filter flags, calls the explain pass with the current prompt, UPDATEs the item's `explanation` (rendered prose) and `metadata_json.structuredExplanation` (structured form). Idempotency by item id, but the script is intentionally re-runnable because regenerating is the point.

### 4.2 Stage 1 emits options WITH opaque ids

The choice between (a) stage 1 emits options without ids and stage 2 generates them at POST, or (b) stage 1 emits options with freshly-generated opaque ids that pass through stage 2 unchanged.

**Recommendation: (b) — stage 1 generates ids.** Three reasons:

1. **Stage-2 prompt simplicity.** The explain pass's prompt and tool input_schema reference `referencedOptions` as opaque ids drawn from the options array it's given. If options arrive at stage 2 without ids, the explain prompt has to invent a temporary scheme just to reference options, then the ids get re-generated at POST. Adding a layer.
2. **Stage 1 JSON is self-contained.** A stage-1 file should be a complete description of an item-in-flight, readable and re-POSTable as-is. Without ids, the stage-1 JSON would be incomplete by design.
3. **The explain LLM seeing real opaque ids in the prompt is fine.** It's the same model that already reads structured tool inputs; opaque ids are just strings. The "LLM never invents ids" rule from §2.2 still holds because stage 1 generates them server-side before stage 2 ever sees the file.

Stage-1 JSON shape:

```json
{
  "sourceImagePath": "data/testbank/12min_prep_practice_1/q43.png",
  "sourceImageHash": "sha256:96349231ea76...",
  "extractedAt": "2026-05-02T20:00:00.000Z",
  "subTypeId": "verbal.antonyms",
  "difficulty": "medium",
  "question": "Which of the following is the opposite of the word \"procure\"?",
  "options": [
    { "id": "k7m3n9px", "text": "replace" },
    { "id": "g4qx2vmt", "text": "pass" },
    { "id": "h2bn8wfy", "text": "sell" },
    { "id": "p9c5dhrk", "text": "place" }
  ],
  "correctAnswer": "h2bn8wfy",
  "originalExplanation": "\"Procure\" – acquire, obtain, purchase. ...",
  "importSource": "ocr-visible"
}
```

`importSource` carries forward unchanged. `originalExplanation` is omitted when not present on the screenshot. `correctAnswer` references one of the opaque ids assigned in `options[]`.

### 4.3 CLI shape per stage

| Script | Required args | Flags |
|---|---|---|
| `scripts/import-questions.ts` | `<inbox-dir>` | `--dry-run`, `--limit N`, `--sample`, `--skip-solve` |
| `scripts/generate-explanations.ts` | `<stage1-dir>` (default `scripts/_stage1/`) | `--dry-run`, `--limit N`, `--sample` (no `--skip-solve` — solve already happened in stage 1) |
| `scripts/regenerate-explanations.ts` | (no positional) | `--dry-run`, `--limit N`, `--sub-type <id>`, `--since <iso-date>`, `--source <real\|generated>` |

Stage 1 and stage 2 reuse the existing `--sample` deterministic-seed implementation (`SAMPLE_SEED = "18seconds-ocr-sample-v1"`). Stage 2's `--sample` samples from across `scripts/_stage1/` recursively; stage 1's matches today's behavior.

Stage 3's filter flags are mutually `AND`-combined. `--sub-type verbal.synonyms --since 2026-04-01` regenerates explanations for every `verbal.synonyms` item ingested after April 1.

### 4.4 Idempotency model — two layers, both keyed on source-image hash

| Layer | Source of truth | Read by | Written by |
|---|---|---|---|
| Stage-1 idempotency | Presence of a JSON file at `scripts/_stage1/<source>/<filename>.json` | Stage 1 (skip if exists) | Stage 1 (write on success) |
| Stage-2 idempotency | `sourceImageHash` field in `scripts/_logs/imported.jsonl` | Stage 2 (skip if hash present) | Stage 2 (append on success) |

Both layers persist across runs. The hash is the only stable join between a stage-1 file and the eventual DB row, and it's what the script logs at every layer.

**Stage 1's idempotency is intentionally file-presence-based**, not log-based. If the stage-1 JSON file exists, the screenshot was successfully extracted; re-extracting would just produce the same file. File-deletion is the reset operation — `rm scripts/_stage1/<source>/q43.png.json` triggers a re-extract on the next stage-1 run. Simpler than threading a stage-1 log.

**Stage 2's idempotency uses `imported.jsonl`** unchanged from today's behavior. The stage-1 file existing doesn't mean the item is in the DB; only `imported.jsonl` does.

### 4.5 Failure isolation

A stage-2 failure (explain pass errored, ingest POST returned 500, etc.) leaves the stage-1 JSON file untouched. The next stage-2 run retries the same input. No replay logic in stage 2 is needed beyond walking the `_stage1/` dir.

A stage-1 failure leaves nothing for stage 2 to consume. The screenshot file stays in its source directory; the next stage-1 run retries it. No coupling.

A failure in the canonical 5-image dry-run for stage 1 means stage 2's dry-run will simply have less input to process — it doesn't propagate the failure.

### 4.6 What the plan does NOT split

The four LLM passes inside stage 1 (extract, solve, verify) stay coupled in a single per-image flow. Aborting any of them aborts the image. Splitting further (e.g., `import-extracts.ts` and `solve-extracts.ts` as separate scripts) would multiply the JSONL log files and idempotency layers without buying anything — extract output isn't useful as a standalone artifact, and solve+verify only run in the answer-not-visible branch which is a per-image decision.

The split is between "produce question state" (stage 1) and "produce explanation state" (stage 2) because those are the natural seams: question state is roughly stable for the lifetime of the bank (re-extracting a screenshot produces the same question), while explanation state changes as the explain prompt evolves. Stage 3 exists exactly because explanation state is mutable in a way question state is not.

## 5. OCR pipeline split — operational changes

### 5.1 Operating procedure (the new runbook)

The "I have a new batch of screenshots" workflow becomes:

1. **Drop the new screenshots into `data/testbank/<new-source-name>/`.**
2. **Run the canonical 5-image dry-run on stage 1:** `bun run scripts/import-questions.ts data/testbank --dry-run --sample --limit 5`. Reviews extraction quality + solve+verify behavior. No explain calls fire.
3. **Run stage 1 for real on the new directory:** `bun run scripts/import-questions.ts data/testbank/<new-source-name>`. Watches end-of-run summary for `extract-failures.jsonl`, `needs-review.jsonl`, `skipped.jsonl`. Stage-1 JSON files land in `scripts/_stage1/<new-source-name>/`.
4. **Run the canonical 5-image dry-run on stage 2:** `bun run scripts/generate-explanations.ts --dry-run --sample --limit 5`. Reviews explanation quality against the stage-1 JSON files (which now include opaque ids in their options). Compares prose against `originalExplanation` where present.
5. **Run stage 2 for real:** `bun run scripts/generate-explanations.ts`. POSTs each stage-1 JSON's item to the ingest route. Watches summary for `explanation-failures.jsonl`, `ingest-failures.jsonl`.
6. **Spot-check 20 items via SQL** as today (the §"Provenance" query in `ocr-import-screenshots.md` continues to work — `metadata_json` shape didn't change).

More steps than today (4 → 6) but each is short, the failure modes are cleanly attributable, and stages 1 and 2 can run on different days against different working states.

For the very first migration-completion run (immediately after the schema migration), the workflow has one extra setup step at zero: **purge `_stage1/` and `imported.jsonl` if any pre-migration content exists**, since pre-migration stage-1 JSON files will have letter ids that the new validation rejects.

### 5.2 Canonical 5-image dry-run — both stages

Recommendation: **run both stages in the canonical dry-run.** Stage-1-only is faster (no explain tokens) and validates extract quality, but the end-to-end signal — does the explain pass produce something readable when fed real stage-1 data with real opaque ids — is what the dry-run exists to check. The 5-image cost is negligible (5 extracts + at most 5 × (solve+verify) + 5 explains ≈ 15-20 Anthropic calls per cycle). Splitting the dry-run into two commands also matches the production workflow, so reviewers see the same shape.

### 5.3 Logs that move and logs that stay

| File | Owner | Lifecycle |
|---|---|---|
| `scripts/_stage1/<source>/<filename>.json` | Stage 1 writes | Persist forever (the source-of-truth for "this screenshot was successfully extracted"). Manually pruneable post-import-success but never deleted programmatically. |
| `scripts/_logs/extract-failures.jsonl` | Stage 1 writes | Existing file, semantics unchanged. |
| `scripts/_logs/needs-review.jsonl` | Stage 1 writes | Existing, unchanged. (Solve+verify disagreements happen in stage 1.) |
| `scripts/_logs/skipped.jsonl` | Stage 1 writes | Existing, unchanged. |
| `scripts/_logs/stage1-complete.jsonl` | Stage 1 writes | **New.** One line per successfully-extracted screenshot, mirrors the stage-1 JSON file's existence as a log-shaped artifact for grep-ability. Schema: `{ timestamp, sourceImagePath, sourceImageHash, subTypeId, difficulty, importSource, hasOriginalExplanation }`. |
| `scripts/_logs/explanation-failures.jsonl` | Stage 2 writes | Existing, unchanged. |
| `scripts/_logs/ingest-failures.jsonl` | Stage 2 writes | Existing, unchanged. |
| `scripts/_logs/imported.jsonl` | Stage 2 writes | Existing — but writes only happen at stage 2 now (today's pipeline writes here at the same moment). Schema unchanged. |
| `scripts/_logs/migrate-opaque-ids.jsonl` | Migration script writes | **New.** One-shot during the migration. See §3.2. |
| `scripts/_logs/stage3-regenerated.jsonl` | Stage 3 writes | **New.** One line per regenerated item, schema `{ timestamp, itemId, subTypeId, oldStructuredExplanation, newStructuredExplanation, oldExplanation, newExplanation }`. The full diff is logged so a regression in the explain prompt can be detected post-hoc. |

`scripts/_stage1/*` is added to `.gitignore`. The directory is created on first stage-1 run (no `.gitkeep` needed; it's purely runtime state).

### 5.4 Cleanup

**`scripts/_stage1/`** persists indefinitely while items derived from it exist in the bank. The source-image hash in each stage-1 JSON is the only link from a DB row back to its source PNG. Deleting `_stage1/` would orphan every imported item from its source. Manual pruning is safe only if the corresponding `imported.jsonl` entries are also pruned AND the user accepts that those items can no longer be re-explained from source.

**`scripts/_logs/imported.jsonl`** continues to be the load-bearing idempotency log. Deletion semantics from `ocr-import-screenshots.md` apply unchanged — never delete unless intentionally re-importing.

## 6. Forward-looking notes

**`regenerate-explanations.ts` is forward investment.** It pays off the next time the explain prompt changes meaningfully — at which point every item ingested under the old prompt has a stale explanation and the only options are (a) live with the staleness, (b) hand-rewrite each item via the admin form, or (c) run a regenerator. (c) is what this script makes cheap. Worth shipping with the rest of the change because it's small (~150 lines, mostly plumbing, the explain-pass code is reusable from stage 2) and the future case is concrete enough that pre-building avoids a future "do we build this or accept the staleness" debate.

**Click-to-highlight (Phase 5/6).** Confirms opaque ids are the architecture for that feature. The renderer reads `metadata_json.structuredExplanation.parts[].referencedOptions` (opaque ids), maps them to the current display positions of the same options in the user's view, and renders tappable spans. No string-matching against prose, no fragility from the explain LLM paraphrasing option text — the structured-source/prose-render architecture from the OCR plan was already this design; opaque ids are the missing piece that unlocks the renderer side.

**Per-session shuffle.** Documents that opaque ids unlock per-session option shuffling without breaking explanations. The session engine can shuffle the array's display order without touching `correctAnswer` (still an opaque id, still equality-compared) or `referencedOptions` (still opaque ids, still resolved by id at render time). Whether shuffle ships in v1 or later is out of scope for this plan; the architecture is ready when it ships.

## 7. Sequencing and commits

Seven commits, in this order. Each is independently testable.

1. **`feat(items): widen option-id validation to accept opaque ids alongside letters`** (`src/` only). Soften Zod schemas in `src/server/items/ingest.ts`, `src/app/api/admin/ingest-item/route.ts`, and `src/config/item-templates.ts`. Drop the `z.enum(["A","B","C","D","E"])` on `referencedOptions` in both `ingest.ts` and `route.ts`. After this commit, validation tolerates either shape. Verify: `bun lint && bun typecheck`. Smoke-test by ingesting a hand-crafted opaque-id item via the existing route's curl path.
2. **`feat(scripts): add opaque-option-id migration script`** (`scripts/` only). Adds `scripts/migrate-opaque-option-ids.ts` and `src/server/items/option-id.ts` (the helper). The script is run out-of-band against the dev DB before the next commit. Verify post-run via SQL: every item has 8-char base32 ids; every `correct_answer` matches a current id; every `referencedOptions` array contains only current ids.
3. **`feat(items): tighten option-id validation to reject letter shape`** (`src/` only). Tighten the schemas softened in commit 1. After this commit, attempting to ingest a letter-id item fails fast with a Zod error at the route boundary. Verify: `bun lint && bun typecheck`. Smoke-test by attempting to ingest a letter-id item via curl and confirming a 400.
4. **`feat(components): compute option display labels from position`** (`src/components/` only). `OptionButton` gains a `displayLabel: string` prop; `ItemPrompt` computes it as `String.fromCharCode(0x41 + index)`. Verify: `bun lint && bun typecheck`; render the `/admin/ingest` flow and confirm options display A/B/C/D as before, despite their underlying ids being opaque.
5. **`feat(scripts): split OCR pipeline into stage-1 question import and stage-2 explanation generation`** (`scripts/` only). Adds `scripts/import-questions.ts` and `scripts/generate-explanations.ts`. Removes `scripts/import-screenshots.ts`. Stage-1 emits opaque ids per §4.2. Both scripts reuse the four-pass LLM helpers from the old script (refactored into `scripts/_lib/explain.ts`, `scripts/_lib/extract.ts`, etc., or kept inline per script — author's call). Verify by running the canonical 5-image cross-source dry-run for both stages.
6. **`feat(scripts): add explanation regeneration script`** (`scripts/` only). Adds `scripts/regenerate-explanations.ts`. Verify by running with `--dry-run --limit 5 --sub-type verbal.synonyms` against the dev DB and confirming the diff log writes correctly to `scripts/_logs/stage3-regenerated.jsonl`.
7. **`docs: update OCR import plan and runbook for opaque ids and pipeline split`** (`docs/` only). Updates `docs/plans/ocr-import-screenshots.md` to point at this plan for the schema/topology details and to reflect the new operating procedure. Marks this plan (`opaque-option-ids-and-pipeline-split.md`) as the canonical reference for both changes.

Each commit is bounded to a single concern and a single area of the codebase. Lint+typecheck runs on each, and the migration script runs once between commits 2 and 3. The dry-run from commit 5's verification step is the load-bearing end-to-end check.

## 8. Out of scope

Explicit list:

- **Building the shuffle feature.** Opaque ids unlock it; this plan does not build it.
- **Building the click-to-highlight UI.** Same.
- **Re-running OCR against any sources where stage 1 has already succeeded.** Stage-1 outputs are persistent.
- **Generating opaque ids LLM-side.** Server-side only. The LLM in extract returns options without ids; the LLM in explain receives opaque ids as input and references them in `referencedOptions`.
- **A schema migration of `items.options_json`'s column type.** The column stays `jsonb`. Only the JSON shape inside changes, validated at the application boundary.
- **Migrating items in shape other than the three fields enumerated in §3.1.** No other field references option ids today; if one is added later (e.g., a strategy that names a specific option), it's that change's job to handle the migration.
- **Changes to the explanation contract or the four-pass LLM pipeline (extract / solve / verify / explain).** Those are settled per `ocr-import-screenshots.md` and the iteration that followed.
- **Changes to `metadata_json`'s shape beyond the `referencedOptions` element type.** The structured-explanation Zod schema, `originalExplanation`, `importSource`, and the `.length(2-3)` + ordering refinement all stay.
