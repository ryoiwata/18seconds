import * as errors from "@superbuilders/errors"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { items } from "@/db/schemas/catalog/items"
import { logger } from "@/logger"
import { itemBody } from "@/server/items/body-schema"
import { embedText } from "@/server/generation/embeddings"

const ErrItemNotFound = errors.new("item not found")
const ErrInvalidBody = errors.new("invalid item body")

interface LoadedItem {
	id: string
	bodyText: string
}

async function loadItemStep(itemId: string): Promise<LoadedItem> {
	"use step"
	const rows = await db
		.select({ id: items.id, body: items.body })
		.from(items)
		.where(eq(items.id, itemId))
		.limit(1)
	const row = rows[0]
	if (!row) {
		logger.warn({ itemId }, "embedding-backfill: item not found")
		throw errors.wrap(ErrItemNotFound, `item id '${itemId}'`)
	}

	const parsed = itemBody.safeParse(row.body)
	if (!parsed.success) {
		logger.error(
			{ itemId, issues: parsed.error.issues },
			"embedding-backfill: item body failed schema validation"
		)
		throw errors.wrap(ErrInvalidBody, `item id '${itemId}'`)
	}

	const text = textForBody(parsed.data)
	return { id: row.id, bodyText: text }
}

function textForBody(body: { kind: "text"; text: string }): string {
	switch (body.kind) {
		case "text":
			return body.text
		default: {
			const _exhaustive: never = body.kind
			return _exhaustive
		}
	}
}

async function embedStep(text: string): Promise<number[]> {
	"use step"
	return embedText(text)
}

async function writeStep(itemId: string, embedding: number[]): Promise<void> {
	"use step"
	const result = await errors.try(
		db.update(items).set({ embedding }).where(eq(items.id, itemId))
	)
	if (result.error) {
		logger.error({ error: result.error, itemId }, "embedding-backfill: update failed")
		throw errors.wrap(result.error, "embedding-backfill update")
	}
	logger.info({ itemId, dimensions: embedding.length }, "embedding-backfill: wrote embedding")
}

async function embeddingBackfillWorkflow(input: { itemId: string }): Promise<void> {
	"use workflow"
	const loaded = await loadItemStep(input.itemId)
	const embedding = await embedStep(loaded.bodyText)
	await writeStep(loaded.id, embedding)
}

export { embeddingBackfillWorkflow, ErrInvalidBody, ErrItemNotFound }
