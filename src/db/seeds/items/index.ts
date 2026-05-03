import "@/env"
import * as errors from "@superbuilders/errors"
import { and, eq, isNull, sql } from "drizzle-orm"
import { type SubTypeId, subTypeIds } from "@/config/sub-types"
import { db } from "@/db"
import { items } from "@/db/schemas/catalog/items"
import { logger } from "@/logger"
import { type IngestRealItemInput, ingestRealItem } from "@/server/items/ingest"
import { seedDataBySubType } from "@/db/seeds/items/data"
import type { SeedItemInput } from "@/db/seeds/items/types"
import { assignOptionIds } from "@/server/items/option-id"

const EMBEDDING_TIMEOUT_MS = 60_000
const EMBEDDING_POLL_INTERVAL_MS = 1_000

interface SkippedRow {
	subTypeId: SubTypeId
	reason: "exists"
}

interface InsertedRow {
	subTypeId: SubTypeId
	itemId: string
}

async function existsByBodyText(text: string): Promise<boolean> {
	const rows = await db
		.select({ id: items.id })
		.from(items)
		.where(sql`${items.body}->>'text' = ${text}`)
		.limit(1)
	return rows.length > 0
}

function toIngestInput(seed: SeedItemInput): IngestRealItemInput {
	const optionsWithIds = assignOptionIds(seed.options)
	const correctOption = optionsWithIds[seed.correctAnswerIndex]
	if (!correctOption) {
		logger.error(
			{
				subTypeId: seed.subTypeId,
				correctAnswerIndex: seed.correctAnswerIndex,
				optionCount: optionsWithIds.length
			},
			"seed: correctAnswerIndex out of range"
		)
		throw errors.new("seed: correctAnswerIndex out of range")
	}
	return {
		subTypeId: seed.subTypeId,
		difficulty: seed.difficulty,
		body: seed.body,
		options: optionsWithIds,
		correctAnswer: correctOption.id,
		explanation: seed.explanation,
		strategyId: seed.strategyId
	}
}

async function ingestOne(seed: SeedItemInput): Promise<InsertedRow | SkippedRow> {
	if (seed.body.kind !== "text") {
		// v1 has only the 'text' body variant; this guard exists so adding a
		// future variant forces an update here rather than silently skipping.
		logger.error({ subTypeId: seed.subTypeId }, "seed: non-text body variants not supported")
		throw errors.new("seed: only text body variant supported in v1")
	}
	const exists = await existsByBodyText(seed.body.text)
	if (exists) {
		return { subTypeId: seed.subTypeId, reason: "exists" }
	}
	const input = toIngestInput(seed)
	const result = await errors.try(ingestRealItem(input))
	if (result.error) {
		logger.error(
			{ error: result.error, subTypeId: seed.subTypeId },
			"seed: ingestRealItem failed"
		)
		throw errors.wrap(result.error, "seed ingestRealItem")
	}
	return { subTypeId: seed.subTypeId, itemId: result.data.itemId }
}

async function waitForEmbeddings(): Promise<void> {
	const start = Date.now()
	while (Date.now() - start < EMBEDDING_TIMEOUT_MS) {
		const rows = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(items)
			.where(and(eq(items.source, "real"), isNull(items.embedding)))
		const first = rows[0]
		if (!first) {
			logger.error("seed: count query returned no rows")
			throw errors.new("seed: count query returned no rows")
		}
		if (first.count === 0) {
			logger.info("seed: all real items have embeddings")
			return
		}
		logger.info({ pending: first.count }, "seed: waiting for embeddings to land")
		await sleep(EMBEDDING_POLL_INTERVAL_MS)
	}
	logger.error({ timeoutMs: EMBEDDING_TIMEOUT_MS }, "seed: embeddings did not converge in time")
	throw errors.new("seed: embeddings did not converge in time")
}

async function sleep(ms: number): Promise<void> {
	await new Promise<void>(function schedule(resolve) {
		setTimeout(resolve, ms)
	})
}

async function main(): Promise<void> {
	const summary: Record<string, { inserted: number; skipped: number }> = {}
	for (const subTypeId of subTypeIds) {
		summary[subTypeId] = { inserted: 0, skipped: 0 }
	}

	for (const subTypeId of subTypeIds) {
		const dataset = seedDataBySubType[subTypeId]
		if (!dataset) {
			logger.error({ subTypeId }, "seed: missing dataset")
			throw errors.new(`seed: missing dataset for ${subTypeId}`)
		}
		logger.info({ subTypeId, count: dataset.length }, "seed: ingesting sub-type")
		for (const input of dataset) {
			const result = await ingestOne(input)
			const cell = summary[subTypeId]
			if (!cell) {
				logger.error({ subTypeId }, "seed: summary cell missing (impossible)")
				throw errors.new("seed: summary cell missing")
			}
			if ("itemId" in result) {
				cell.inserted += 1
				logger.info(
					{ subTypeId, itemId: result.itemId },
					"seed: inserted real item"
				)
			} else {
				cell.skipped += 1
			}
		}
	}

	logger.info({ summary }, "seed: per-sub-type summary")

	logger.info("seed: waiting for embeddings to converge")
	await waitForEmbeddings()
}

const result = await errors.try(main())
if (result.error) {
	logger.error({ error: result.error }, "seed: failed")
	process.exit(1)
}
process.exit(0)
