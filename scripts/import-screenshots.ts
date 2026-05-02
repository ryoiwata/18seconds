// scripts/import-screenshots.ts
//
// OCR import pipeline for CCAT question screenshots. Persistent tooling
// for ingesting new test-bank sources into the items bank.
//
// EXEMPT FROM THE PROJECT RULESET. This file is a standalone Bun script,
// not part of the app source tree. It uses console.log, native try/catch,
// and other patterns banned in src/. Do not copy idioms from this file
// into src/.
//
// Usage and operating procedure: see docs/plans/ocr-import-screenshots.md
// (the runbook for sample-then-full import workflow, including the
// canonical 5-image cross-source dry-run).

import Anthropic from "@anthropic-ai/sdk"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { z } from "zod"
import { type SubTypeId, subTypeIds, subTypes } from "@/config/sub-types"

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const EXTRACT_MODEL = "claude-sonnet-4-6"
const SOLVE_MODEL = "claude-sonnet-4-6"
const VERIFY_MODEL = "claude-sonnet-4-6"
const EXPLAIN_MODEL = "claude-sonnet-4-6"

// ---------------------------------------------------------------------------
// Sub-type style hints (one entry per v1 sub-type, drafted from
// docs/CCAT-categories.md). Each entry pairs a recognition cue with the
// fastest method. Trap-avoidance is intentionally NOT in here — the
// unified-explanation prompt's optional third sentence handles per-question
// traps.
// ---------------------------------------------------------------------------

const subTypeStyleHints: Record<SubTypeId, string> = {
	"verbal.synonyms":
		"Recognition is fast or absent — if the test-taker doesn't know the word, deliberation rarely helps. Frame the explanation around the word's core sense.",
	"verbal.antonyms":
		"When two options point opposite, the more general opposite usually wins. Watch for words with multiple meanings keyed to the less obvious sense.",
	"verbal.analogies":
		"Name the relationship in plain words ('puppy is a young dog') before scanning options — articulating it filters distractors. Common relationship types: function, part-to-whole, category-to-member, intensity, synonymy.",
	"verbal.sentence_completion":
		"Read the conjunctions first ('although', 'because', 'despite') — they telegraph whether the blank agrees or contrasts with surrounding text. For double-blank questions, eliminate any option whose first word fails before evaluating the second.",
	"verbal.logic":
		"Treat the premises as a closed world — only what is stated counts, real-world knowledge does not enter. For spatial-direction problems, sketch a line; for syllogisms, the correct conclusion is the most modest claim that strictly follows.",
	"numerical.number_series":
		"Test consecutive differences first, then ratios, then second-order patterns (differences-of-differences). Check memorized sets (cubes, primes, squares) only after those fail; most series resolve at the first level.",
	"numerical.letter_series":
		"Convert letters to position numbers (A=1, B=2, …) when the pattern doesn't resolve at a glance, then apply number-series logic. For multi-letter groups, each position usually has its own arithmetic rule.",
	"numerical.word_problems":
		"Translate the prose into a single equation or sketch before computing — translation is the bottleneck, not the arithmetic. Most problems resolve to one or two operations once the relationship is named (rate × time, parts × cost, distance ÷ speed).",
	"numerical.fractions":
		"For 'highest value' questions where all fractions are close to 1, compare the remaining part to 1 (e.g. 14/15 leaves 1/15) — faster than direct comparison. Cross-multiply for two-fraction comparisons; don't compute decimals.",
	"numerical.percentages":
		"The 10% block trick is the fastest method: shift the decimal one place left, then scale. For stacked changes, anchor on the new base each step — a 50% increase then 50% decrease does not return to the start.",
	"numerical.averages_ratios":
		"Averages: sum-over-count works almost always; for add/remove problems, redistribute the delta from the mean rather than recomputing. Ratios: distinguish parts-to-parts from parts-to-whole — set up 7x + 9x = total for a 7:9 ratio."
}

// ---------------------------------------------------------------------------
// Sub-type list rendered into prompts at runtime. Single source of truth is
// `subTypes` from src/config/sub-types.ts.
// ---------------------------------------------------------------------------

function buildSubTypeList(): string {
	return subTypes
		.map((entry) => `- ${entry.id} — ${entry.displayName} (section: ${entry.section})`)
		.join("\n")
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const optionLetter = z.enum(["A", "B", "C", "D", "E"])

const extractedItem = z
	.object({
		isTextOnly: z.boolean(),
		question: z.string().min(1),
		options: z
			.array(
				z.object({
					id: optionLetter,
					text: z.string().min(1)
				})
			)
			.min(2)
			.max(5),
		answerVisible: z.boolean(),
		correctAnswer: optionLetter.optional(),
		explanationVisible: z.boolean(),
		originalExplanation: z.string().min(1).optional(),
		subTypeId: z.enum(subTypeIds),
		difficulty: z.enum(["easy", "medium", "hard", "brutal"])
	})
	.refine((d) => !d.answerVisible || d.correctAnswer !== undefined, {
		message: "answerVisible=true but correctAnswer missing"
	})
	.refine((d) => !d.explanationVisible || d.originalExplanation !== undefined, {
		message: "explanationVisible=true but originalExplanation missing"
	})

type ExtractedItem = z.infer<typeof extractedItem>

const solverOutput = z.object({
	correctAnswer: optionLetter,
	reasoning: z.string().min(1),
	confidence: z.number().int().min(1).max(5)
})

type SolverOutput = z.infer<typeof solverOutput>

const verifierOutput = z
	.object({
		agrees: z.boolean(),
		correctIfDisagree: optionLetter.optional(),
		reason: z.string().min(1).optional()
	})
	.refine((d) => d.agrees || d.correctIfDisagree !== undefined, {
		message: "agrees=false but correctIfDisagree missing"
	})

type VerifierOutput = z.infer<typeof verifierOutput>

const unifiedExplanationOutput = z.object({
	explanation: z.string().min(1)
})

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const EXTRACT_SYSTEM_TEMPLATE = `You are an OCR + classification helper for CCAT (Criteria Cognitive Aptitude Test) practice screenshots. You will be shown one screenshot at a time, each containing one multiple-choice question.

Your job is to extract the question's structured content and classify it into one of the 11 v1 sub-types.

Sub-types (id — display name (section)):

\${SUB_TYPE_LIST}

Difficulty (anchored by question features, not by the latency thresholds the names suggest):

- easy: vocabulary the average adult knows; arithmetic doable in your head in under 5 seconds; clear pattern.
- medium: less common vocabulary; arithmetic needing one written intermediate step; pattern requires a moment to spot.
- hard: uncommon vocabulary or trap distractors; multi-step arithmetic with fractions/percentages; pattern with two interleaved rules.
- brutal: vocabulary most adults wouldn't know; calculation path itself is hard to see; deeply ambiguous patterns.

Estimate from question complexity. Ignore any "Difficulty: hard" label printed on the screenshot.

Important conventions of CCAT screenshots:
- Some screenshots show the correct answer (a green checkmark, a highlighted option, a "Correct answer: X" line, or a "✓" next to one option). When you see one, set "answerVisible": true and put the option letter in "correctAnswer".
- Some screenshots show a written explanation below the question, typically titled "Explanation", "Solution", or similar. When present, set "explanationVisible": true and copy the explanation text verbatim into "originalExplanation". Preserve tables and structured layouts as best you can in plain text — they will be used as background context, not user-facing.
- If neither is shown, set both flags to false and omit "correctAnswer" and "originalExplanation".
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
  "originalExplanation": <string>,            // only if explanationVisible (verbatim from screenshot)
  "subTypeId": <one of the 11 ids above>,
  "difficulty": "easy"|"medium"|"hard"|"brutal"
}`

const SOLVE_SYSTEM = `You are solving a single CCAT (Criteria Cognitive Aptitude Test) multiple-choice question. Your job is to identify the correct option. Your reasoning will be checked by an independent verifier.

Respond with raw JSON only — no markdown code fences, no commentary, just the object:

{
  "correctAnswer": "A"|"B"|"C"|"D"|"E",
  "reasoning": <2–4 sentence explanation of your method, used for verification>,
  "confidence": <integer 1–5, where 5 = certain and 1 = guess>
}`

const VERIFY_SYSTEM = `You are an independent verifier for CCAT (Criteria Cognitive Aptitude Test) answers. You will be given a question, the answer options, and another solver's claimed answer + reasoning.

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
}`

const EXPLAIN_SYSTEM_TEMPLATE = `You are writing a post-session-review explanation for a CCAT (Criteria Cognitive Aptitude Test) multiple-choice question. The user has already attempted the question; they are now reviewing what they got wrong (or got slowly). Your explanation is what they read.

The CCAT gives 18 seconds per question. Your explanation is NOT a derivation. It is a compressed pattern lesson the user can carry to the next item of the same kind.

The contract — follow it strictly:

Write 2–3 sentences of plain prose, in this order:

1. RECOGNITION CUE (1 sentence, ≤ 12 words). Name the pattern category in language the user could carry to a fresh problem of the same kind. Examples: "This is a percent-of-whole problem with two stacked changes." / "Antonym pair where two options point opposite; the more general one wins." / "Letter-series problem with two competing rules."

2. METHOD (1 sentence, ≤ 25 words). The fastest path to the answer, framed as what the test-taker DOES — not as an equation derivation. Use simple inline numbers/expressions if needed. Examples: "Apply the 10% trick: 10% of 300 is 30, so 5% is 15, leaving 95%." / "Test differences first: 2, 3, 4, 5 — the next term is F + 4 = J."

3. TRAP (1 sentence, ≤ 18 words, OPTIONAL — include only when a distractor exemplifies a common error worth naming by category). Examples: "Don't subtract percentages directly across the two changes — anchor each step on the new base." / "The most-tempting wrong answer applies the rule to the LAST term only; check the full sequence."

Hard rules:
- Plain prose only. No bullets, no headers, no LaTeX, no multi-line equations.
- Total length: 2 sentences (without trap) or 3 sentences (with trap). NEVER 1 sentence, NEVER 4+.
- Do not address the user ("You should…", "Notice that…"). Describe the method in third person or imperative.
- Do not re-state the question or the answer letter. The user is looking at both.
- Do not name option letters (A/B/C/D/E) in the explanation. Refer to options by content if at all.
- Do not say "the correct answer is…". The system already shows that.

Sub-type style hint for this question: \${SUB_TYPE_HINT}

Respond with raw JSON only — no markdown code fences, no commentary, just the object:

{ "explanation": <2–3 sentences per the contract above> }`

// ---------------------------------------------------------------------------
// Stub pipeline functions (filled in Step 6)
// ---------------------------------------------------------------------------

interface ExtractResult {
	ok: true
	data: ExtractedItem
	rawOutput: string
}
interface ExtractFailure {
	ok: false
	stage: "extract"
	rawOutput: string
	error: string
}

async function extractFromImage(_imagePath: string): Promise<ExtractResult | ExtractFailure> {
	throw new Error("not implemented")
}

async function solveQuestion(
	_question: string,
	_options: { id: string; text: string }[]
): Promise<SolverOutput> {
	throw new Error("not implemented")
}

async function verifyAnswer(
	_question: string,
	_options: { id: string; text: string }[],
	_claim: SolverOutput
): Promise<VerifierOutput> {
	throw new Error("not implemented")
}

async function writeUnifiedExplanation(
	_question: string,
	_options: { id: string; text: string }[],
	_correctAnswer: string,
	_subTypeId: SubTypeId,
	_originalExplanation: string | undefined
): Promise<string> {
	throw new Error("not implemented")
}

interface IngestPayload {
	subTypeId: SubTypeId
	difficulty: ExtractedItem["difficulty"]
	body: { kind: "text"; text: string }
	options: { id: string; text: string }[]
	correctAnswer: string
	explanation: string
	metadata: {
		importSource: "ocr-visible" | "ocr-solved"
		originalExplanation?: string
	}
}

async function postToIngest(_payload: IngestPayload): Promise<{ status: number; body: string }> {
	throw new Error("not implemented")
}

// ---------------------------------------------------------------------------
// CLI parsing + main
// ---------------------------------------------------------------------------

interface CliArgs {
	inboxDir: string
	dryRun: boolean
	limit: number | undefined
	sample: boolean
	skipSolve: boolean
}

function printUsage(): void {
	console.log(`Usage: bun run scripts/import-screenshots.ts <inbox-dir> [--dry-run] [--limit N] [--sample] [--skip-solve]

Arguments:
  <inbox-dir>     Required. Path to a folder of PNG screenshots.

Flags:
  --dry-run       Extract (and solve/verify/explain if needed) but do not POST. Logs to stdout.
  --limit N       Stop after processing N images.
  --sample        Recursively sample N images deterministically from across <inbox-dir>.
                  Use with --limit to control the sample size.
  --skip-solve    For images where the answer is not visible, log to skipped and continue
                  instead of running solve+verify.
  --help, -h      Print this usage message and exit.

See docs/plans/ocr-import-screenshots.md for the full runbook.`)
}

function parseArgs(argv: string[]): CliArgs | { help: true } {
	const args = argv.slice(2)
	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		return { help: true }
	}

	let inboxDir: string | undefined
	let dryRun = false
	let limit: number | undefined
	let sample = false
	let skipSolve = false

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === "--dry-run") {
			dryRun = true
		} else if (arg === "--sample") {
			sample = true
		} else if (arg === "--skip-solve") {
			skipSolve = true
		} else if (arg === "--limit") {
			const next = args[i + 1]
			if (!next) {
				console.error("--limit requires a value")
				process.exit(1)
			}
			const parsed = Number.parseInt(next, 10)
			if (!Number.isFinite(parsed) || parsed < 1) {
				console.error(`--limit must be a positive integer, got: ${next}`)
				process.exit(1)
			}
			limit = parsed
			i++
		} else if (arg && arg.startsWith("--")) {
			console.error(`unknown flag: ${arg}`)
			process.exit(1)
		} else if (arg && !inboxDir) {
			inboxDir = arg
		} else {
			console.error(`unexpected argument: ${arg}`)
			process.exit(1)
		}
	}

	if (!inboxDir) {
		console.error("inbox-dir is required")
		printUsage()
		process.exit(1)
	}

	const resolved = path.resolve(inboxDir)
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
		console.error(`inbox-dir does not exist or is not a directory: ${resolved}`)
		process.exit(1)
	}

	return { inboxDir: resolved, dryRun, limit, sample, skipSolve }
}

async function main(): Promise<void> {
	const parsed = parseArgs(Bun.argv)
	if ("help" in parsed) {
		printUsage()
		return
	}

	console.log("import-screenshots: parsed args:", JSON.stringify(parsed, null, 2))
	console.log("(skeleton — pipeline implemented in Step 6)")
}

await main()

// Silence unused-variable warnings for Step 4 skeleton. These are exported in
// spirit (they're the constants future Step 6 wiring will reference); the
// noop reference here just keeps the file from looking like it has dead code.
void EXTRACT_MODEL
void SOLVE_MODEL
void VERIFY_MODEL
void EXPLAIN_MODEL
void Anthropic
void createHash
void buildSubTypeList
void subTypeStyleHints
void extractedItem
void solverOutput
void verifierOutput
void unifiedExplanationOutput
void EXTRACT_SYSTEM_TEMPLATE
void SOLVE_SYSTEM
void VERIFY_SYSTEM
void EXPLAIN_SYSTEM_TEMPLATE
void extractFromImage
void solveQuestion
void verifyAnswer
void writeUnifiedExplanation
void postToIngest
