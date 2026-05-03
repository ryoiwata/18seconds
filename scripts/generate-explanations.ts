// scripts/generate-explanations.ts
//
// Stage 2 of the split OCR pipeline. Walks scripts/_stage1/ recursively;
// per stage-1 JSON file: idempotency check (source-image hash against
// scripts/_logs/imported.jsonl), call the explain pass, POST to
// http://localhost:3000/api/admin/ingest-item, append to imported.jsonl.
//
// EXEMPT FROM THE PROJECT RULESET. Native try/catch, console.log, etc.
//
// See docs/plans/opaque-option-ids-and-pipeline-split.md §4 for the design
// and §5.1 for the runbook.

import * as fs from "node:fs"
import * as path from "node:path"
import { z } from "zod"
import { type SubTypeId, subTypeIds } from "@/config/sub-types"
import { errorToString, throttle } from "@scripts/_lib/anthropic"
import {
	renderExplanationProse,
	type StructuredExplanationOutput,
	writeStructuredExplanation
} from "@scripts/_lib/explain"
import {
	appendJsonl,
	ensureLogsDir,
	EXPLANATION_FAILURES_LOG,
	IMPORTED_LOG,
	INGEST_FAILURES_LOG,
	loadImportedHashes,
	nowIso,
	STAGE1_DIR
} from "@scripts/_lib/logs"
import { deterministicSample, SAMPLE_SEED } from "@scripts/_lib/sample"

const cronSecret = Bun.env.CRON_SECRET
if (!cronSecret) {
	console.error("CRON_SECRET is missing from .env")
	process.exit(1)
}

const stage1JsonSchema = z.object({
	sourceImagePath: z.string().min(1),
	sourceImageHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
	extractedAt: z.string().min(1),
	subTypeId: z.enum(subTypeIds),
	difficulty: z.enum(["easy", "medium", "hard", "brutal"]),
	question: z.string().min(1),
	options: z
		.array(z.object({ id: z.string().regex(/^[0-9a-z]{8}$/), text: z.string().min(1) }))
		.min(2)
		.max(5),
	correctAnswer: z.string().regex(/^[0-9a-z]{8}$/),
	originalExplanation: z.string().min(1).optional(),
	importSource: z.enum(["ocr-visible", "ocr-solved"])
})

type Stage1Json = z.infer<typeof stage1JsonSchema>

interface CliArgs {
	stage1Dir: string
	dryRun: boolean
	limit: number | undefined
	sample: boolean
}

function printUsage(): void {
	console.log(`Usage: bun run scripts/generate-explanations.ts [<stage1-dir>] [--dry-run] [--limit N] [--sample]

Stage 2 of the split OCR pipeline: read each stage-1 JSON file, run the explain pass,
POST the resulting item to /api/admin/ingest-item.

Arguments:
  <stage1-dir>    Optional. Path to a stage-1 directory. Defaults to scripts/_stage1/.
                  Recurses into subdirectories.

Flags:
  --dry-run       Run explain but do not POST and do not append to imported.jsonl.
  --limit N       Stop after processing N stage-1 files.
  --sample        Deterministically sample N files from across the directory tree.
                  REQUIRES --limit.
  --help, -h      Print this usage message and exit.

See docs/plans/opaque-option-ids-and-pipeline-split.md §5.1 for the full runbook.`)
}

function parseArgs(argv: string[]): CliArgs | { help: true } {
	const args = argv.slice(2)
	if (args.includes("--help") || args.includes("-h")) {
		return { help: true }
	}

	let stage1Dir: string | undefined
	let dryRun = false
	let limit: number | undefined
	let sample = false

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === "--dry-run") {
			dryRun = true
		} else if (arg === "--sample") {
			sample = true
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
		} else if (arg?.startsWith("--")) {
			console.error(`unknown flag: ${arg}`)
			process.exit(1)
		} else if (arg && !stage1Dir) {
			stage1Dir = arg
		} else {
			console.error(`unexpected argument: ${arg}`)
			process.exit(1)
		}
	}

	if (sample && limit === undefined) {
		console.error("--sample requires --limit (the deterministic sample size must be explicit)")
		process.exit(1)
	}

	const resolved = path.resolve(stage1Dir ?? STAGE1_DIR)
	if (!fs.existsSync(resolved)) {
		console.error(`stage1-dir does not exist: ${resolved}`)
		process.exit(1)
	}
	if (!fs.statSync(resolved).isDirectory()) {
		console.error(`stage1-dir is not a directory: ${resolved}`)
		process.exit(1)
	}

	return { stage1Dir: resolved, dryRun, limit, sample }
}

function listJsonRecursive(dir: string): string[] {
	const out: string[] = []
	function walk(current: string): void {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name)
			if (entry.isDirectory()) {
				walk(full)
			} else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
				out.push(full)
			}
		}
	}
	walk(dir)
	out.sort()
	return out
}

interface IngestPayload {
	subTypeId: SubTypeId
	difficulty: Stage1Json["difficulty"]
	body: { kind: "text"; text: string }
	options: { id: string; text: string }[]
	correctAnswer: string
	explanation: string
	metadata: {
		importSource: "ocr-visible" | "ocr-solved"
		originalExplanation?: string
		structuredExplanation?: StructuredExplanationOutput
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

interface Counters {
	totalFiles: number
	alreadyImported: number
	parseFailures: number
	explanationFailures: number
	ingestFailures: number
	successOcrVisible: number
	successOcrSolved: number
	successWithOriginal: number
	successWithoutOriginal: number
}

function newCounters(totalFiles: number): Counters {
	return {
		totalFiles,
		alreadyImported: 0,
		parseFailures: 0,
		explanationFailures: 0,
		ingestFailures: 0,
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
	console.log("=== Stage 2 summary ===")
	console.log(`Total stage-1 files:         ${pad(c.totalFiles, 4)}`)
	console.log(`Already imported:            ${pad(c.alreadyImported, 4)}`)
	console.log(`Parse failures:              ${pad(c.parseFailures, 4)}`)
	console.log(`Explanation failures:        ${pad(c.explanationFailures, 4)}`)
	console.log(`Ingest failures:             ${pad(c.ingestFailures, 4)}`)
	console.log(`Successfully ingested:       ${pad(success, 4)}`)
	console.log(
		`  - visible answer:          ${pad(c.successOcrVisible, 4)}  (orig explanation: ${c.successWithOriginal}, no orig: ${c.successWithoutOriginal})`
	)
	console.log(`  - solve + verify:          ${pad(c.successOcrSolved, 4)}`)
}

async function processStage1File(
	stage1Path: string,
	args: CliArgs,
	counters: Counters,
	importedHashes: Set<string>
): Promise<void> {
	const relPath = path.relative(process.cwd(), stage1Path)
	console.log(`\n--- ${relPath}`)

	let raw: string
	try {
		raw = fs.readFileSync(stage1Path, "utf8")
	} catch (err) {
		counters.parseFailures++
		console.log(`  [read failed] ${errorToString(err)}`)
		return
	}

	let json: unknown
	try {
		json = JSON.parse(raw)
	} catch (err) {
		counters.parseFailures++
		console.log(`  [parse failed] ${errorToString(err)}`)
		return
	}

	const parsed = stage1JsonSchema.safeParse(json)
	if (!parsed.success) {
		counters.parseFailures++
		console.log(`  [schema failed] ${JSON.stringify(parsed.error.issues)}`)
		return
	}

	const data = parsed.data
	const bareHash = data.sourceImageHash.replace(/^sha256:/, "")

	if (importedHashes.has(bareHash) || importedHashes.has(data.sourceImageHash)) {
		counters.alreadyImported++
		console.log(`  [skip] already imported (hash=${bareHash.slice(0, 12)}…)`)
		return
	}

	console.log(
		`  [stage-1] subType=${data.subTypeId} difficulty=${data.difficulty} importSource=${data.importSource} options=${data.options.length}`
	)

	console.log("  [explain]")
	let structured: StructuredExplanationOutput
	try {
		structured = await writeStructuredExplanation(
			data.question,
			data.options,
			data.correctAnswer,
			data.subTypeId,
			data.originalExplanation
		)
	} catch (err) {
		counters.explanationFailures++
		console.log(`  [explain failed] ${errorToString(err)}`)
		if (!args.dryRun) {
			appendJsonl(EXPLANATION_FAILURES_LOG, {
				timestamp: nowIso(),
				stage1Path: relPath,
				sourceImageHash: data.sourceImageHash,
				question: data.question,
				correctAnswer: data.correctAnswer,
				error: errorToString(err)
			})
		}
		return
	}

	const explanation = renderExplanationProse(structured)

	if (args.dryRun) {
		console.log("  [structured explanation]")
		const prettyStructured = JSON.stringify(structured, null, 2)
			.split("\n")
			.map((l) => `    ${l}`)
			.join("\n")
		console.log(prettyStructured)
		console.log("  [rendered prose]")
		console.log(`    ${explanation}`)
		if (data.originalExplanation) {
			console.log("  [original explanation — for side-by-side comparison]")
			const indented = data.originalExplanation
				.split("\n")
				.map((l) => `    ${l}`)
				.join("\n")
			console.log(indented)
		}
	} else {
		console.log("  [rendered prose]")
		console.log(`    ${explanation}`)
	}

	const payload: IngestPayload = {
		subTypeId: data.subTypeId,
		difficulty: data.difficulty,
		body: { kind: "text", text: data.question },
		options: data.options,
		correctAnswer: data.correctAnswer,
		explanation,
		metadata: {
			importSource: data.importSource,
			structuredExplanation: structured,
			...(data.originalExplanation ? { originalExplanation: data.originalExplanation } : {})
		}
	}

	if (args.dryRun) {
		console.log(`  [DRY-RUN] would POST as importSource=${data.importSource}`)
		if (data.importSource === "ocr-visible") {
			counters.successOcrVisible++
			if (data.originalExplanation) counters.successWithOriginal++
			else counters.successWithoutOriginal++
		} else {
			counters.successOcrSolved++
		}
		return
	}

	const ingestResult = await postToIngest(payload)
	if (ingestResult.status < 200 || ingestResult.status >= 300) {
		counters.ingestFailures++
		console.log(`  [ingest failed] HTTP ${ingestResult.status}: ${ingestResult.body}`)
		appendJsonl(INGEST_FAILURES_LOG, {
			timestamp: nowIso(),
			stage1Path: relPath,
			sourceImageHash: data.sourceImageHash,
			status: ingestResult.status,
			responseBody: ingestResult.body,
			requestBody: payload
		})
		return
	}

	let itemId = "unknown"
	try {
		const parsedBody = JSON.parse(ingestResult.body)
		if (typeof parsedBody.itemId === "string") itemId = parsedBody.itemId
	} catch {
		// Successful 2xx but unparseable body — log itemId as "unknown" and proceed.
	}

	appendJsonl(IMPORTED_LOG, {
		timestamp: nowIso(),
		stage1Path: relPath,
		sourceImagePath: data.sourceImagePath,
		sourceImageHash: data.sourceImageHash,
		itemId,
		subTypeId: data.subTypeId,
		difficulty: data.difficulty,
		importSource: data.importSource,
		hadOriginalExplanation: Boolean(data.originalExplanation)
	})
	importedHashes.add(bareHash)
	importedHashes.add(data.sourceImageHash)

	if (data.importSource === "ocr-visible") {
		counters.successOcrVisible++
		if (data.originalExplanation) counters.successWithOriginal++
		else counters.successWithoutOriginal++
	} else {
		counters.successOcrSolved++
	}
	console.log(`  [ingested] itemId=${itemId} importSource=${data.importSource}`)
}

async function main(): Promise<void> {
	const parsed = parseArgs(Bun.argv)
	if ("help" in parsed) {
		printUsage()
		return
	}
	const args = parsed

	ensureLogsDir()

	console.log(`generate-explanations: stage1Dir=${args.stage1Dir}`)
	console.log(
		`  flags: dryRun=${args.dryRun} limit=${args.limit ?? "(none)"} sample=${args.sample}`
	)

	const candidates = listJsonRecursive(args.stage1Dir)
	console.log(`  found ${candidates.length} stage-1 file(s)`)

	let queue = candidates
	if (args.sample) {
		if (args.limit === undefined) throw new Error("invariant: --sample requires --limit")
		queue = deterministicSample(candidates, args.limit)
		console.log(`  deterministic sample of ${queue.length} (seed=${SAMPLE_SEED}):`)
		for (const f of queue) console.log(`    - ${path.relative(process.cwd(), f)}`)
	} else if (args.limit !== undefined) {
		queue = queue.slice(0, args.limit)
	}

	if (queue.length === 0) {
		console.warn("warning: no stage-1 files to process")
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
		for (const stage1Path of queue) {
			if (interrupted) break
			try {
				await processStage1File(stage1Path, args, counters, importedHashes)
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
