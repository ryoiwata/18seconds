// masteryRecomputeWorkflow — fired by endSession (and, in commit 3, by the
// abandon-sweep cron). Walks the distinct sub-types touched in the
// session and calls recomputeForUser per sub-type. Each recompute is its
// own `'use step'` so a transient failure on one sub-type doesn't lose
// work done for the others (independent retry per the architecture-plan
// generation-pipeline pattern).
//
// SPEC §9.4. Sequential, not parallelized — the few hundred milliseconds
// saved by parallelism aren't worth the partial-failure complexity.

import * as errors from "@superbuilders/errors"
import { eq } from "drizzle-orm"
import { type SubTypeId, subTypeIds } from "@/config/sub-types"
import { db } from "@/db"
import { items } from "@/db/schemas/catalog/items"
import { attempts } from "@/db/schemas/practice/attempts"
import { practiceSessions } from "@/db/schemas/practice/practice-sessions"
import { logger } from "@/logger"
import type { MasterySource } from "@/server/mastery/compute"
import { recomputeForUser } from "@/server/mastery/recompute"

const ErrSessionRowMissing = errors.new("session row missing during recompute workflow")
const ErrUnknownSubTypeId = errors.new("sub_type_id not in v1 SubTypeId union")

interface SessionMetadata {
	userId: string
	source: MasterySource
}

const subTypeIdSet: ReadonlySet<string> = new Set<string>(subTypeIds)

function asSubTypeId(s: string): SubTypeId {
	if (!subTypeIdSet.has(s)) {
		logger.error({ subTypeId: s }, "masteryRecomputeWorkflow: unknown sub_type_id")
		throw errors.wrap(ErrUnknownSubTypeId, `value '${s}'`)
	}
	const matched = subTypeIds.find(function eq(known) {
		return known === s
	})
	if (!matched) {
		logger.error({ subTypeId: s }, "masteryRecomputeWorkflow: post-guard miss (impossible)")
		throw errors.wrap(ErrUnknownSubTypeId, `post-guard miss for '${s}'`)
	}
	return matched
}

async function loadSessionMetadata(sessionId: string): Promise<SessionMetadata> {
	"use step"
	const result = await errors.try(
		db
			.select({ userId: practiceSessions.userId, type: practiceSessions.type })
			.from(practiceSessions)
			.where(eq(practiceSessions.id, sessionId))
			.limit(1)
	)
	if (result.error) {
		logger.error(
			{ error: result.error, sessionId },
			"masteryRecomputeWorkflow: session metadata read failed"
		)
		throw errors.wrap(result.error, "loadSessionMetadata")
	}
	const row = result.data[0]
	if (!row) {
		logger.error({ sessionId }, "masteryRecomputeWorkflow: session row missing")
		throw errors.wrap(ErrSessionRowMissing, `session id '${sessionId}'`)
	}
	let source: MasterySource = "ongoing"
	if (row.type === "diagnostic") source = "diagnostic"
	return { userId: row.userId, source }
}

async function listDistinctSubTypes(sessionId: string): Promise<SubTypeId[]> {
	"use step"
	const result = await errors.try(
		db
			.selectDistinct({ subTypeId: items.subTypeId })
			.from(attempts)
			.innerJoin(items, eq(attempts.itemId, items.id))
			.where(eq(attempts.sessionId, sessionId))
	)
	if (result.error) {
		logger.error(
			{ error: result.error, sessionId },
			"masteryRecomputeWorkflow: distinct sub-type query failed"
		)
		throw errors.wrap(result.error, "listDistinctSubTypes")
	}
	const out: SubTypeId[] = []
	for (const row of result.data) {
		out.push(asSubTypeId(row.subTypeId))
	}
	return out
}

async function recomputeStep(
	userId: string,
	subTypeId: SubTypeId,
	source: MasterySource
): Promise<void> {
	"use step"
	const result = await errors.try(recomputeForUser(userId, subTypeId, source))
	if (result.error) {
		logger.error(
			{ error: result.error, userId, subTypeId, source },
			"masteryRecomputeWorkflow: recomputeForUser failed"
		)
		throw errors.wrap(result.error, "recomputeForUser")
	}
}

async function masteryRecomputeWorkflow(input: { sessionId: string }): Promise<void> {
	"use workflow"
	const meta = await loadSessionMetadata(input.sessionId)
	const subTypes = await listDistinctSubTypes(input.sessionId)
	logger.info(
		{ sessionId: input.sessionId, subTypeCount: subTypes.length, source: meta.source },
		"masteryRecomputeWorkflow: starting per-sub-type recompute loop"
	)
	for (const subTypeId of subTypes) {
		await recomputeStep(meta.userId, subTypeId, meta.source)
	}
}

export { ErrSessionRowMissing, ErrUnknownSubTypeId, masteryRecomputeWorkflow }
