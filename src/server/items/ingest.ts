import * as errors from "@superbuilders/errors"
import { start } from "workflow/api"
import { z } from "zod"
import { type Difficulty, subTypeIds, type SubTypeId } from "@/config/sub-types"
import { db } from "@/db"
import { items } from "@/db/schemas/catalog/items"
import { logger } from "@/logger"
import { itemBody, type ItemBody } from "@/server/items/body-schema"
import { embeddingBackfillWorkflow } from "@/workflows/embedding-backfill"

const ErrIngestValidation = errors.new("ingest validation failed")

const optionSchema = z.object({
	id: z.string().min(1).max(64),
	text: z.string().min(1)
})

const ingestMetadata = z.object({
	originalExplanation: z.string().min(1).optional(),
	importSource: z.string().min(1).max(64).optional()
})

const ingestInput = z.object({
	subTypeId: z.enum(subTypeIds),
	difficulty: z.enum(["easy", "medium", "hard", "brutal"]),
	body: itemBody,
	options: z.array(optionSchema).min(2).max(5),
	correctAnswer: z.string().min(1).max(64),
	explanation: z.string().min(1).optional(),
	strategyId: z.string().uuid().optional(),
	metadata: ingestMetadata.optional()
})

interface IngestRealItemInput {
	subTypeId: SubTypeId
	difficulty: Difficulty
	body: ItemBody
	options: { id: string; text: string }[]
	correctAnswer: string
	explanation?: string
	strategyId?: string
	metadata?: {
		originalExplanation?: string
		importSource?: string
	}
}

async function ingestRealItem(input: IngestRealItemInput): Promise<{ itemId: string }> {
	const parsed = ingestInput.safeParse(input)
	if (!parsed.success) {
		logger.error(
			{ issues: parsed.error.issues },
			"ingestRealItem: input failed schema validation"
		)
		throw errors.wrap(ErrIngestValidation, "input schema")
	}

	const data = parsed.data

	const optionIds = new Set<string>()
	for (const option of data.options) {
		if (optionIds.has(option.id)) {
			logger.error({ optionId: option.id }, "ingestRealItem: duplicate option id")
			throw errors.wrap(ErrIngestValidation, `duplicate option id '${option.id}'`)
		}
		optionIds.add(option.id)
	}

	if (!optionIds.has(data.correctAnswer)) {
		logger.error(
			{ correctAnswer: data.correctAnswer, optionIds: [...optionIds] },
			"ingestRealItem: correctAnswer does not match any option id"
		)
		throw errors.wrap(ErrIngestValidation, "correctAnswer not in options")
	}

	const metadataJson: Record<string, string> = {}
	if (data.metadata?.originalExplanation) {
		metadataJson.originalExplanation = data.metadata.originalExplanation
	}
	if (data.metadata?.importSource) {
		metadataJson.importSource = data.metadata.importSource
	}

	const insertResult = await errors.try(
		db
			.insert(items)
			.values({
				subTypeId: data.subTypeId,
				difficulty: data.difficulty,
				source: "real",
				status: "live",
				body: data.body,
				optionsJson: data.options,
				correctAnswer: data.correctAnswer,
				explanation: data.explanation,
				strategyId: data.strategyId,
				metadataJson
			})
			.returning({ id: items.id })
	)
	if (insertResult.error) {
		logger.error(
			{ error: insertResult.error, subTypeId: data.subTypeId },
			"ingestRealItem: insert failed"
		)
		throw errors.wrap(insertResult.error, "ingestRealItem insert")
	}

	const inserted = insertResult.data[0]
	if (!inserted) {
		logger.error({ subTypeId: data.subTypeId }, "ingestRealItem: insert returning empty")
		throw errors.new("ingestRealItem insert returned no rows")
	}

	const itemId = inserted.id

	logger.info(
		{ itemId, subTypeId: data.subTypeId, difficulty: data.difficulty },
		"ingestRealItem: inserted real item"
	)

	// Trigger embedding backfill. In dev this awaits the OpenAI roundtrip; in
	// production with Vercel Workflows the call enqueues durably and the await
	// resolves once the workflow run is registered (steps run asynchronously).
	const backfillResult = await errors.try(start(embeddingBackfillWorkflow, [{ itemId }]))
	if (backfillResult.error) {
		logger.error(
			{ error: backfillResult.error, itemId },
			"ingestRealItem: embedding-backfill workflow failed to start"
		)
		throw errors.wrap(backfillResult.error, "embeddingBackfillWorkflow")
	}

	return { itemId }
}

export type { IngestRealItemInput }
export { ErrIngestValidation, ingestInput, ingestRealItem }
