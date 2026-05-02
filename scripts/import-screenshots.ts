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
import { Buffer } from "node:buffer"
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

const EXTRACT_MAX_TOKENS = 2048
const SOLVE_MAX_TOKENS = 512
const VERIFY_MAX_TOKENS = 512
const EXPLAIN_MAX_TOKENS = 512

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

Call the extract_ccat_question tool with the question's structured content. The tool's input_schema defines every field name and type — populate every required field, and only include "correctAnswer" / "originalExplanation" when their corresponding visibility flag is true.`

const SOLVE_SYSTEM = `You are solving a single CCAT (Criteria Cognitive Aptitude Test) multiple-choice question. Your job is to identify the correct option. Your reasoning will be checked by an independent verifier.

Call the submit_solver_answer tool with your chosen option, your reasoning (2–4 sentences explaining your method, used downstream by the verifier), and your confidence (1–5).`

const VERIFY_SYSTEM = `You are an independent verifier for CCAT (Criteria Cognitive Aptitude Test) answers. You will be given a question, the answer options, and another solver's claimed answer + reasoning.

Your protocol:
1. Solve the question yourself first, BEFORE looking at the claim. Pick the option you would choose.
2. Then read the claim. If the claim's answer matches yours AND the claim's reasoning is sound (no obvious errors), set agrees=true.
3. If the claim's answer does not match yours, set agrees=false, put your answer in correctIfDisagree, and explain the discrepancy in reason in 1–2 sentences.
4. If the claim's answer matches yours but its reasoning has a clear error (e.g. arithmetic mistake masked by a coincidentally correct option), set agrees=false and explain in reason.

Call the submit_verifier_judgment tool with your verdict.`

const EXPLAIN_SYSTEM_TEMPLATE = `You are writing a post-session-review explanation for a CCAT (Criteria Cognitive Aptitude Test) multiple-choice question. The user has already attempted the question; they are now reviewing what they got wrong (or got slowly). Your explanation is what they read.

The CCAT gives 18 seconds per question. Your explanation is NOT a derivation. It is a compressed pattern lesson the user can carry to the next item of the same kind.

The contract — follow it strictly:

Write 2–3 sentences of plain prose, in this order:

1. RECOGNITION CUE — exactly 8-12 words. Name the pattern category in language the user could carry to a fresh problem of the same kind. Examples: "This is a percent-of-whole problem with two stacked changes." / "Antonym pair where two options point opposite; the more general one wins." / "Letter-series problem with two competing rules."

2. METHOD — exactly 18-25 words. The fastest path to the answer, framed as what the test-taker DOES — not as an equation derivation. Use simple inline numbers/expressions if needed. Examples: "Apply the 10% trick: 10% of 300 is 30, so 5% is 15, leaving 95%." / "Test differences first: 2, 3, 4, 5 — the next term is F + 4 = J."

3. TRAP — exactly 12-18 words, OPTIONAL (include only when a distractor exemplifies a common error worth naming by category). Examples: "Don't subtract percentages directly across the two changes — anchor each step on the new base." / "The most-tempting wrong answer applies the rule to the LAST term only; check the full sequence."

Before submitting, count the words in each sentence. If any sentence is outside its target range, rewrite that sentence to fit. Sentences are length-bounded for review-screen consistency, not as a guideline.

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
// Anthropic client + rate limit + backoff
// ---------------------------------------------------------------------------

const anthropicKey = Bun.env.ANTHROPIC_API_KEY
if (!anthropicKey) {
	console.error("ANTHROPIC_API_KEY is missing from .env")
	process.exit(1)
}
const cronSecret = Bun.env.CRON_SECRET
if (!cronSecret) {
	console.error("CRON_SECRET is missing from .env")
	process.exit(1)
}

const client = new Anthropic({ apiKey: anthropicKey })

const MIN_REQUEST_INTERVAL_MS = 1000
let lastRequestStartMs = 0

async function throttle(): Promise<void> {
	const now = Date.now()
	const elapsed = now - lastRequestStartMs
	if (elapsed < MIN_REQUEST_INTERVAL_MS) {
		await Bun.sleep(MIN_REQUEST_INTERVAL_MS - elapsed)
	}
	lastRequestStartMs = Date.now()
}

const BACKOFF_DELAYS_MS = [1000, 2000, 4000]

async function withBackoff<T>(label: string, fn: () => Promise<T>): Promise<T> {
	let lastErr: unknown
	for (let attempt = 0; attempt <= BACKOFF_DELAYS_MS.length; attempt++) {
		try {
			await throttle()
			return await fn()
		} catch (err) {
			lastErr = err
			const is429 = err instanceof Anthropic.APIError && err.status === 429
			if (is429 && attempt < BACKOFF_DELAYS_MS.length) {
				const delay = BACKOFF_DELAYS_MS[attempt] ?? 4000
				console.warn(`[rate-limit] ${label} 429, retry ${attempt + 1}/${BACKOFF_DELAYS_MS.length} in ${delay}ms`)
				await Bun.sleep(delay)
				continue
			}
			throw err
		}
	}
	throw lastErr
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorToString(err: unknown): string {
	if (err instanceof Error) return err.message
	return String(err)
}

// ---------------------------------------------------------------------------
// Pipeline functions
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

// Anthropic tool definition for the extract pass. Forcing tool_choice to this
// tool guarantees the model returns a `tool_use` content block whose `input` is
// a parsed JS object — no JSON.parse step, no fence-stripping, no string-escape
// pitfalls. The `extractedItem` Zod schema below still runs on the parsed
// object to enforce the conditional refines (answerVisible↔correctAnswer,
// explanationVisible↔originalExplanation) that JSON Schema can't express
// cleanly on its own.
const EXTRACT_TOOL_NAME = "extract_ccat_question"
const EXTRACT_TOOL: Anthropic.Messages.Tool = {
	name: EXTRACT_TOOL_NAME,
	description:
		"Return the CCAT question's extracted content as structured fields. Populate every required field. Only set correctAnswer when answerVisible is true. Only set originalExplanation when explanationVisible is true.",
	input_schema: {
		type: "object",
		properties: {
			isTextOnly: {
				type: "boolean",
				description:
					"false if any answer choice (or the question itself) is a chart, shape, image, or visual diagram"
			},
			question: {
				type: "string",
				description: "the question prompt text verbatim from the screenshot"
			},
			options: {
				type: "array",
				minItems: 2,
				maxItems: 5,
				items: {
					type: "object",
					properties: {
						id: { type: "string", enum: ["A", "B", "C", "D", "E"] },
						text: { type: "string" }
					},
					required: ["id", "text"]
				}
			},
			answerVisible: {
				type: "boolean",
				description:
					"true when a checkmark, highlight, 'Correct answer: X' line, or '✓' marks the correct option"
			},
			correctAnswer: {
				type: "string",
				enum: ["A", "B", "C", "D", "E"],
				description: "set ONLY when answerVisible is true"
			},
			explanationVisible: {
				type: "boolean",
				description: "true when a written explanation is shown below the question"
			},
			originalExplanation: {
				type: "string",
				description: "verbatim from the screenshot. set ONLY when explanationVisible is true"
			},
			subTypeId: {
				type: "string",
				enum: [...subTypeIds]
			},
			difficulty: {
				type: "string",
				enum: ["easy", "medium", "hard", "brutal"]
			}
		},
		required: [
			"isTextOnly",
			"question",
			"options",
			"answerVisible",
			"explanationVisible",
			"subTypeId",
			"difficulty"
		]
	}
}

async function extractFromImage(imagePath: string): Promise<ExtractResult | ExtractFailure> {
	const buf = await Bun.file(imagePath).arrayBuffer()
	const b64 = Buffer.from(buf).toString("base64")

	const system = EXTRACT_SYSTEM_TEMPLATE.replace("${SUB_TYPE_LIST}", buildSubTypeList())

	let message: Anthropic.Messages.Message
	try {
		message = await withBackoff(`extract:${path.basename(imagePath)}`, () =>
			client.messages.create({
				model: EXTRACT_MODEL,
				max_tokens: EXTRACT_MAX_TOKENS,
				temperature: 0,
				system,
				tools: [EXTRACT_TOOL],
				tool_choice: { type: "tool", name: EXTRACT_TOOL_NAME },
				messages: [
					{
						role: "user",
						content: [
							{
								type: "image",
								source: { type: "base64", media_type: "image/png", data: b64 }
							},
							{
								type: "text",
								text: `Extract this CCAT question by calling the ${EXTRACT_TOOL_NAME} tool.`
							}
						]
					}
				]
			})
		)
	} catch (err) {
		return { ok: false, stage: "extract", rawOutput: "", error: errorToString(err) }
	}

	let toolInput: unknown
	for (const block of message.content) {
		if (block.type === "tool_use" && block.name === EXTRACT_TOOL_NAME) {
			toolInput = block.input
			break
		}
	}

	if (toolInput === undefined) {
		return {
			ok: false,
			stage: "extract",
			rawOutput: JSON.stringify(message.content),
			error: `no ${EXTRACT_TOOL_NAME} tool_use block in response`
		}
	}

	const rawOutput = JSON.stringify(toolInput)

	const parsed = extractedItem.safeParse(toolInput)
	if (!parsed.success) {
		return {
			ok: false,
			stage: "extract",
			rawOutput,
			error: `Zod validation failed: ${JSON.stringify(parsed.error.issues)}`
		}
	}

	return { ok: true, data: parsed.data, rawOutput }
}

function formatOptionsBlock(options: { id: string; text: string }[]): string {
	return options.map((o) => `${o.id}. ${o.text}`).join("\n")
}

// Solver tool. Same rationale as the extract tool: forced tool_choice
// guarantees the model returns a parsed JS object, eliminating the
// prose-preamble class of failures (q21 letter-series question hit this in
// text mode) without a regex pre-parser.
const SOLVE_TOOL_NAME = "submit_solver_answer"
const SOLVE_TOOL: Anthropic.Messages.Tool = {
	name: SOLVE_TOOL_NAME,
	description:
		"Submit your answer for the CCAT question along with reasoning and confidence. Reasoning is consumed by the downstream verifier and should make the method check-able.",
	input_schema: {
		type: "object",
		properties: {
			correctAnswer: { type: "string", enum: ["A", "B", "C", "D", "E"] },
			reasoning: {
				type: "string",
				description: "2–4 sentences naming the method used"
			},
			confidence: {
				type: "integer",
				minimum: 1,
				maximum: 5,
				description: "5 = certain, 1 = guess"
			}
		},
		required: ["correctAnswer", "reasoning", "confidence"]
	}
}

async function solveQuestion(
	question: string,
	options: { id: string; text: string }[]
): Promise<SolverOutput> {
	const userContent = `Question:\n${question}\n\nOptions:\n${formatOptionsBlock(options)}`

	const message = await withBackoff("solve", () =>
		client.messages.create({
			model: SOLVE_MODEL,
			max_tokens: SOLVE_MAX_TOKENS,
			temperature: 0,
			system: SOLVE_SYSTEM,
			tools: [SOLVE_TOOL],
			tool_choice: { type: "tool", name: SOLVE_TOOL_NAME },
			messages: [{ role: "user", content: userContent }]
		})
	)

	let toolInput: unknown
	for (const block of message.content) {
		if (block.type === "tool_use" && block.name === SOLVE_TOOL_NAME) {
			toolInput = block.input
			break
		}
	}
	if (toolInput === undefined) {
		throw new Error(`no ${SOLVE_TOOL_NAME} tool_use block in solve response`)
	}

	const parsed = solverOutput.safeParse(toolInput)
	if (!parsed.success) {
		throw new Error(`solver Zod validation failed: ${JSON.stringify(parsed.error.issues)}`)
	}
	return parsed.data
}

// Verifier tool. Same migration rationale: avoid the same prose-preamble class
// preemptively. Verify is structurally identical to solve in terms of failure
// surface.
const VERIFY_TOOL_NAME = "submit_verifier_judgment"
const VERIFY_TOOL: Anthropic.Messages.Tool = {
	name: VERIFY_TOOL_NAME,
	description:
		"Submit your verdict on the solver's claim. Set agrees=true if you arrived at the same answer with sound reasoning. Set agrees=false otherwise, fill in correctIfDisagree with the option YOU would pick, and explain the discrepancy in reason.",
	input_schema: {
		type: "object",
		properties: {
			agrees: { type: "boolean" },
			correctIfDisagree: {
				type: "string",
				enum: ["A", "B", "C", "D", "E"],
				description: "set ONLY when agrees is false"
			},
			reason: {
				type: "string",
				description: "set ONLY when agrees is false; 1–2 sentences explaining the discrepancy"
			}
		},
		required: ["agrees"]
	}
}

async function verifyAnswer(
	question: string,
	options: { id: string; text: string }[],
	claim: SolverOutput
): Promise<VerifierOutput> {
	// Fresh conversation: brand-new messages array, NOT chained from solve. The
	// SDK call is structurally separate.
	const userContent = [
		"Question:",
		question,
		"",
		"Options:",
		formatOptionsBlock(options),
		"",
		`Claimed answer: ${claim.correctAnswer}`,
		`Claimed reasoning: ${claim.reasoning}`
	].join("\n")

	const message = await withBackoff("verify", () =>
		client.messages.create({
			model: VERIFY_MODEL,
			max_tokens: VERIFY_MAX_TOKENS,
			temperature: 0,
			system: VERIFY_SYSTEM,
			tools: [VERIFY_TOOL],
			tool_choice: { type: "tool", name: VERIFY_TOOL_NAME },
			messages: [{ role: "user", content: userContent }]
		})
	)

	let toolInput: unknown
	for (const block of message.content) {
		if (block.type === "tool_use" && block.name === VERIFY_TOOL_NAME) {
			toolInput = block.input
			break
		}
	}
	if (toolInput === undefined) {
		throw new Error(`no ${VERIFY_TOOL_NAME} tool_use block in verify response`)
	}

	const parsed = verifierOutput.safeParse(toolInput)
	if (!parsed.success) {
		throw new Error(`verifier Zod validation failed: ${JSON.stringify(parsed.error.issues)}`)
	}
	return parsed.data
}

// Explain tool. Earlier rationale for skipping the explain migration —
// "single-string outputs don't have a JSON-validity surface for commentary to
// leak into" — was wrong. The JSON wrapper IS the surface; q21 hit the same
// prose-preamble pattern. Tool-use eliminates it by construction.
const EXPLAIN_TOOL_NAME = "submit_unified_explanation"
const EXPLAIN_TOOL: Anthropic.Messages.Tool = {
	name: EXPLAIN_TOOL_NAME,
	description:
		"Submit the unified post-session-review explanation as plain prose, following the contract in the system prompt.",
	input_schema: {
		type: "object",
		properties: {
			explanation: { type: "string" }
		},
		required: ["explanation"]
	}
}

async function writeUnifiedExplanation(
	question: string,
	options: { id: string; text: string }[],
	correctAnswer: string,
	subTypeId: SubTypeId,
	originalExplanation: string | undefined
): Promise<string> {
	const hint = subTypeStyleHints[subTypeId]
	const system = EXPLAIN_SYSTEM_TEMPLATE.replace("${SUB_TYPE_HINT}", hint)

	const userContent = [
		"Question:",
		question,
		"",
		"Options:",
		formatOptionsBlock(options),
		"",
		`Correct answer: ${correctAnswer}`,
		"",
		`Source explanation (background context only — write a fresh explanation, do not paraphrase): ${originalExplanation ?? "(none)"}`
	].join("\n")

	const message = await withBackoff("explain", () =>
		client.messages.create({
			model: EXPLAIN_MODEL,
			max_tokens: EXPLAIN_MAX_TOKENS,
			temperature: 0,
			system,
			tools: [EXPLAIN_TOOL],
			tool_choice: { type: "tool", name: EXPLAIN_TOOL_NAME },
			messages: [{ role: "user", content: userContent }]
		})
	)

	let toolInput: unknown
	for (const block of message.content) {
		if (block.type === "tool_use" && block.name === EXPLAIN_TOOL_NAME) {
			toolInput = block.input
			break
		}
	}
	if (toolInput === undefined) {
		throw new Error(`no ${EXPLAIN_TOOL_NAME} tool_use block in explain response`)
	}

	const parsed = unifiedExplanationOutput.safeParse(toolInput)
	if (!parsed.success) {
		throw new Error(`explanation Zod validation failed: ${JSON.stringify(parsed.error.issues)}`)
	}
	return parsed.data.explanation
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

async function postToIngest(payload: IngestPayload): Promise<{ status: number; body: string }> {
	await throttle()
	const res = await fetch("http://localhost:3000/api/admin/ingest-item", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${cronSecret}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify(payload)
	})
	const body = await res.text()
	return { status: res.status, body }
}

// ---------------------------------------------------------------------------
// Logging (one JSON object per line, append-only)
// ---------------------------------------------------------------------------

const LOGS_DIR = path.resolve(import.meta.dir, "_logs")
const IMPORTED_LOG = path.join(LOGS_DIR, "imported.jsonl")
const SKIPPED_LOG = path.join(LOGS_DIR, "skipped.jsonl")
const EXTRACT_FAILURES_LOG = path.join(LOGS_DIR, "extract-failures.jsonl")
const EXPLANATION_FAILURES_LOG = path.join(LOGS_DIR, "explanation-failures.jsonl")
const NEEDS_REVIEW_LOG = path.join(LOGS_DIR, "needs-review.jsonl")
const INGEST_FAILURES_LOG = path.join(LOGS_DIR, "ingest-failures.jsonl")

function appendJsonl(file: string, obj: unknown): void {
	fs.appendFileSync(file, `${JSON.stringify(obj)}\n`)
}

function loadImportedHashes(): Set<string> {
	const hashes = new Set<string>()
	if (!fs.existsSync(IMPORTED_LOG)) return hashes
	const content = fs.readFileSync(IMPORTED_LOG, "utf8")
	for (const line of content.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed) continue
		try {
			const parsed = JSON.parse(trimmed)
			if (typeof parsed.hash === "string") hashes.add(parsed.hash)
		} catch {
			// Skip malformed lines silently — log file shouldn't have them but better
			// than crashing on a corrupted line.
		}
	}
	return hashes
}

function nowIso(): string {
	return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// File walking + deterministic sampling
// ---------------------------------------------------------------------------

const SAMPLE_SEED = "18seconds-ocr-sample-v1"

function listPngsTopLevel(dir: string): string[] {
	const out: string[] = []
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
			out.push(path.join(dir, entry.name))
		}
	}
	out.sort()
	return out
}

function listPngsRecursive(dir: string): string[] {
	const out: string[] = []
	function walk(current: string): void {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name)
			if (entry.isDirectory()) {
				walk(full)
			} else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
				out.push(full)
			}
		}
	}
	walk(dir)
	out.sort()
	return out
}

function deterministicSample(files: string[], count: number): string[] {
	const hashed = files.map((file) => ({
		file,
		hash: createHash("sha256").update(`${SAMPLE_SEED}|${file}`).digest("hex")
	}))
	hashed.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
	return hashed.slice(0, count).map((h) => h.file)
}

function sha256File(filePath: string): string {
	const buf = fs.readFileSync(filePath)
	return createHash("sha256").update(buf).digest("hex")
}

// ---------------------------------------------------------------------------
// CLI parsing + main loop
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
                  REQUIRES --limit to specify the sample size (no implicit "everything").
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

	if (sample && limit === undefined) {
		console.error("--sample requires --limit (the deterministic sample size must be explicit)")
		process.exit(1)
	}

	const resolved = path.resolve(inboxDir)
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
		console.error(`inbox-dir does not exist or is not a directory: ${resolved}`)
		process.exit(1)
	}

	return { inboxDir: resolved, dryRun, limit, sample, skipSolve }
}

interface Counters {
	totalFiles: number
	alreadyImported: number
	skippedVisual: number
	skippedNoSolve: number
	extractFailures: number
	explanationFailures: number
	ingestFailures: number
	needsReview: number
	successOcrVisible: number
	successOcrSolved: number
	successWithOriginal: number
	successWithoutOriginal: number
}

function newCounters(totalFiles: number): Counters {
	return {
		totalFiles,
		alreadyImported: 0,
		skippedVisual: 0,
		skippedNoSolve: 0,
		extractFailures: 0,
		explanationFailures: 0,
		ingestFailures: 0,
		needsReview: 0,
		successOcrVisible: 0,
		successOcrSolved: 0,
		successWithOriginal: 0,
		successWithoutOriginal: 0
	}
}

function pad(value: string | number, width: number): string {
	return String(value).padStart(width, " ")
}

function printSummary(c: Counters): void {
	const success = c.successOcrVisible + c.successOcrSolved
	console.log("")
	console.log("=== End-of-run summary ===")
	console.log(`Total files:                 ${pad(c.totalFiles, 4)}`)
	console.log(`Already imported:            ${pad(c.alreadyImported, 4)}`)
	console.log(`Skipped (visual):            ${pad(c.skippedVisual, 4)}`)
	console.log(`Skipped (no-solve):          ${pad(c.skippedNoSolve, 4)}`)
	console.log(`Extract failures:            ${pad(c.extractFailures, 4)}`)
	console.log(`Explanation failures:        ${pad(c.explanationFailures, 4)}`)
	console.log(`Ingest failures:             ${pad(c.ingestFailures, 4)}`)
	console.log(`Needs review:                ${pad(c.needsReview, 4)}`)
	console.log(`Successfully ingested:       ${pad(success, 4)}`)
	console.log(
		`  - visible answer:          ${pad(c.successOcrVisible, 4)}  (orig explanation: ${c.successWithOriginal}, no orig: ${c.successWithoutOriginal})`
	)
	console.log(`  - solve + verify:          ${pad(c.successOcrSolved, 4)}`)
}

async function processImage(
	filePath: string,
	args: CliArgs,
	counters: Counters,
	importedHashes: Set<string>
): Promise<void> {
	const hash = sha256File(filePath)
	const relPath = path.relative(process.cwd(), filePath)
	const shortHash = hash.slice(0, 12)

	console.log(`\n--- ${relPath}  [${shortHash}…]`)

	if (importedHashes.has(hash)) {
		counters.alreadyImported++
		console.log("  [skip] already imported")
		return
	}

	const result = await extractFromImage(filePath)
	if (!result.ok) {
		counters.extractFailures++
		console.log(`  [extract failed] ${result.error}`)
		if (!args.dryRun) {
			appendJsonl(EXTRACT_FAILURES_LOG, {
				timestamp: nowIso(),
				filePath: relPath,
				hash,
				stage: "extract",
				rawOutput: result.rawOutput,
				error: result.error
			})
		}
		return
	}

	const data = result.data
	console.log(
		`  [extracted] subType=${data.subTypeId} difficulty=${data.difficulty} answerVisible=${data.answerVisible} explanationVisible=${data.explanationVisible} isTextOnly=${data.isTextOnly}`
	)
	if (args.dryRun) {
		console.log("  [extracted JSON]")
		const pretty = JSON.stringify(data, null, 2)
			.split("\n")
			.map((l) => `    ${l}`)
			.join("\n")
		console.log(pretty)
	}

	if (!data.isTextOnly) {
		counters.skippedVisual++
		console.log("  [skip] not text-only (visual content)")
		if (!args.dryRun) {
			appendJsonl(SKIPPED_LOG, {
				timestamp: nowIso(),
				filePath: relPath,
				hash,
				reason: "visual content"
			})
		}
		return
	}

	let correctAnswer: string
	let importSource: "ocr-visible" | "ocr-solved"

	if (data.answerVisible && data.correctAnswer) {
		correctAnswer = data.correctAnswer
		importSource = "ocr-visible"
		console.log(`  [answer from screenshot] ${correctAnswer}`)
	} else {
		if (args.skipSolve) {
			counters.skippedNoSolve++
			console.log("  [skip] no answer visible, --skip-solve set")
			if (!args.dryRun) {
				appendJsonl(SKIPPED_LOG, {
					timestamp: nowIso(),
					filePath: relPath,
					hash,
					reason: "needs solve, --skip-solve set"
				})
			}
			return
		}

		console.log("  [solve]")
		let solver: SolverOutput
		try {
			solver = await solveQuestion(data.question, data.options)
		} catch (err) {
			counters.needsReview++
			console.log(`  [solve failed] ${errorToString(err)} → needs-review`)
			if (!args.dryRun) {
				appendJsonl(NEEDS_REVIEW_LOG, {
					timestamp: nowIso(),
					filePath: relPath,
					hash,
					failureMode: "solve-error",
					question: data.question,
					options: data.options,
					error: errorToString(err)
				})
			}
			return
		}
		console.log(`  [solver] answer=${solver.correctAnswer} confidence=${solver.confidence}`)
		if (args.dryRun) console.log(`  [solver reasoning] ${solver.reasoning}`)

		console.log("  [verify]")
		let verifier: VerifierOutput
		try {
			verifier = await verifyAnswer(data.question, data.options, solver)
		} catch (err) {
			counters.needsReview++
			console.log(`  [verify failed] ${errorToString(err)} → needs-review`)
			if (!args.dryRun) {
				appendJsonl(NEEDS_REVIEW_LOG, {
					timestamp: nowIso(),
					filePath: relPath,
					hash,
					failureMode: "verify-error",
					question: data.question,
					options: data.options,
					solver,
					error: errorToString(err)
				})
			}
			return
		}
		console.log(
			`  [verifier] agrees=${verifier.agrees}${verifier.correctIfDisagree ? ` (would pick ${verifier.correctIfDisagree})` : ""}`
		)
		if (args.dryRun && verifier.reason) console.log(`  [verifier reason] ${verifier.reason}`)

		if (!verifier.agrees) {
			counters.needsReview++
			console.log("  [skip] solver+verifier disagree → needs-review")
			if (!args.dryRun) {
				appendJsonl(NEEDS_REVIEW_LOG, {
					timestamp: nowIso(),
					filePath: relPath,
					hash,
					failureMode: "verify-disagreed",
					question: data.question,
					options: data.options,
					solver,
					verifier
				})
			}
			return
		}

		correctAnswer = solver.correctAnswer
		importSource = "ocr-solved"
	}

	console.log("  [explain]")
	let explanation: string
	try {
		explanation = await writeUnifiedExplanation(
			data.question,
			data.options,
			correctAnswer,
			data.subTypeId,
			data.originalExplanation
		)
	} catch (err) {
		counters.explanationFailures++
		console.log(`  [explain failed] ${errorToString(err)}`)
		if (!args.dryRun) {
			appendJsonl(EXPLANATION_FAILURES_LOG, {
				timestamp: nowIso(),
				filePath: relPath,
				hash,
				question: data.question,
				correctAnswer,
				error: errorToString(err)
			})
		}
		return
	}
	console.log("  [unified explanation]")
	console.log(`    ${explanation}`)
	if (args.dryRun && data.originalExplanation) {
		console.log("  [original explanation — for side-by-side comparison]")
		const indented = data.originalExplanation
			.split("\n")
			.map((l) => `    ${l}`)
			.join("\n")
		console.log(indented)
	}

	if (args.dryRun) {
		console.log(`  [DRY-RUN] would POST as importSource=${importSource}`)
		if (importSource === "ocr-visible") {
			counters.successOcrVisible++
			if (data.originalExplanation) counters.successWithOriginal++
			else counters.successWithoutOriginal++
		} else {
			counters.successOcrSolved++
		}
		return
	}

	const payload: IngestPayload = {
		subTypeId: data.subTypeId,
		difficulty: data.difficulty,
		body: { kind: "text", text: data.question },
		options: data.options,
		correctAnswer,
		explanation,
		metadata: {
			importSource,
			...(data.originalExplanation ? { originalExplanation: data.originalExplanation } : {})
		}
	}

	const ingestResult = await postToIngest(payload)
	if (ingestResult.status < 200 || ingestResult.status >= 300) {
		counters.ingestFailures++
		console.log(`  [ingest failed] HTTP ${ingestResult.status}: ${ingestResult.body}`)
		appendJsonl(INGEST_FAILURES_LOG, {
			timestamp: nowIso(),
			filePath: relPath,
			hash,
			status: ingestResult.status,
			responseBody: ingestResult.body,
			requestBody: payload
		})
		return
	}

	let itemId = "unknown"
	try {
		const parsed = JSON.parse(ingestResult.body)
		if (typeof parsed.itemId === "string") itemId = parsed.itemId
	} catch {
		// Successful 2xx but unparseable body — log itemId as "unknown" and proceed.
	}

	appendJsonl(IMPORTED_LOG, {
		timestamp: nowIso(),
		filePath: relPath,
		hash,
		itemId,
		subTypeId: data.subTypeId,
		difficulty: data.difficulty,
		importSource,
		hadOriginalExplanation: Boolean(data.originalExplanation)
	})
	importedHashes.add(hash)

	if (importSource === "ocr-visible") {
		counters.successOcrVisible++
		if (data.originalExplanation) counters.successWithOriginal++
		else counters.successWithoutOriginal++
	} else {
		counters.successOcrSolved++
	}
	console.log(`  [ingested] itemId=${itemId} importSource=${importSource}`)
}

async function main(): Promise<void> {
	const parsed = parseArgs(Bun.argv)
	if ("help" in parsed) {
		printUsage()
		return
	}
	const args = parsed

	if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true })

	console.log(`import-screenshots: inbox=${args.inboxDir}`)
	console.log(
		`  flags: dryRun=${args.dryRun} limit=${args.limit ?? "(none)"} sample=${args.sample} skipSolve=${args.skipSolve}`
	)

	const candidates = args.sample
		? listPngsRecursive(args.inboxDir)
		: listPngsTopLevel(args.inboxDir)

	console.log(
		`  found ${candidates.length} .png file(s) ${args.sample ? "(recursive)" : "(top-level only)"}`
	)

	let queue = candidates
	if (args.sample) {
		// parseArgs guarantees args.limit is defined when --sample is set.
		if (args.limit === undefined) throw new Error("invariant: --sample requires --limit")
		queue = deterministicSample(candidates, args.limit)
		console.log(`  deterministic sample of ${queue.length} (seed=${SAMPLE_SEED}):`)
		for (const f of queue) console.log(`    - ${path.relative(process.cwd(), f)}`)
	} else if (args.limit !== undefined) {
		queue = queue.slice(0, args.limit)
	}

	if (queue.length === 0) {
		console.warn("warning: no .png files to process")
	}

	const importedHashes = loadImportedHashes()
	console.log(`  loaded ${importedHashes.size} previously-imported hash(es)`)

	const counters = newCounters(queue.length)

	let interrupted = false
	const handleInterrupt = (): void => {
		interrupted = true
		console.log("\n[interrupted] flushing summary…")
	}
	process.on("SIGINT", handleInterrupt)
	process.on("SIGTERM", handleInterrupt)

	try {
		for (const filePath of queue) {
			if (interrupted) break
			try {
				await processImage(filePath, args, counters, importedHashes)
			} catch (err) {
				console.log(`  [unhandled] ${errorToString(err)}`)
				if (err instanceof Error && err.stack) console.log(err.stack)
			}
		}
	} finally {
		printSummary(counters)
	}
}

await main().catch((err: unknown) => {
	console.error("[fatal]", errorToString(err))
	if (err instanceof Error && err.stack) console.error(err.stack)
	process.exit(1)
})
