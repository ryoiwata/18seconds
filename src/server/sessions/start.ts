// startSession — underlying function. Auth is the caller's responsibility
// (the (app)/actions.ts wrapper resolves userId from auth() and passes it
// through). Keeping userId explicit lets dev/test paths exercise this from
// raw Bun without Next.js context, which is what the commit-1 smoke does.
//
// SPEC §7.1 / Plan §6.1 (diagnostic) and §6.4 (drill).

import * as errors from "@superbuilders/errors"
import type { SubTypeId } from "@/config/sub-types"
import { db } from "@/db"
import { practiceSessions } from "@/db/schemas/practice/practice-sessions"
import { logger } from "@/logger"
import { computeRecencyExcludedSet } from "@/server/items/recency"
import { getNextItem, type ItemForRender } from "@/server/items/selection"

const ErrInvalidStartInput = errors.new("invalid startSession input")
const ErrSessionInsertFailed = errors.new("session insert returned no rows")
const ErrFirstItemMissing = errors.new("first item could not be selected")

type SessionType = "diagnostic" | "drill" | "full_length" | "simulation" | "review"
type TimerMode = "standard" | "speed_ramp" | "brutal"
type DrillLength = 5 | 10 | 20

interface StartSessionInput {
	userId: string
	type: SessionType
	subTypeId?: SubTypeId
	timerMode?: TimerMode
	drillLength?: DrillLength
	ifThenPlan?: string
}

interface StartSessionResult {
	sessionId: string
	firstItem: ItemForRender
}

function targetQuestionCountFor(input: StartSessionInput): number {
	if (input.type === "diagnostic") return 50
	if (input.type === "drill") {
		if (input.drillLength === undefined) {
			logger.error({ type: input.type }, "startSession: drill missing drillLength")
			throw errors.wrap(ErrInvalidStartInput, "drill requires drillLength")
		}
		return input.drillLength
	}
	if (input.type === "full_length" || input.type === "simulation") return 50
	if (input.type === "review") {
		// Phase 5: review session reads count from `review_queue` due-set size.
		// Throws here so any Phase 3 caller that strays into this branch fails
		// fast — no Phase 3 path constructs a review session anyway.
		logger.error({ type: input.type }, "startSession: review type not yet supported")
		throw errors.wrap(ErrInvalidStartInput, "review session type deferred to phase 5")
	}
	const _exhaustive: never = input.type
	return _exhaustive
}

function validateInputShape(input: StartSessionInput): void {
	if (input.type === "drill") {
		if (input.subTypeId === undefined) {
			logger.error({ type: input.type }, "startSession: drill missing subTypeId")
			throw errors.wrap(ErrInvalidStartInput, "drill requires subTypeId")
		}
		if (input.timerMode === undefined) {
			logger.error({ type: input.type }, "startSession: drill missing timerMode")
			throw errors.wrap(ErrInvalidStartInput, "drill requires timerMode")
		}
	}
}

async function startSession(input: StartSessionInput): Promise<StartSessionResult> {
	validateInputShape(input)
	const target = targetQuestionCountFor(input)
	const nowMs = Date.now()

	const recencyExcluded = await computeRecencyExcludedSet(input.userId, nowMs)

	// timerMode defaults to NULL in the DB for non-drill types; for drills it
	// MUST come from the caller (validated above).
	let timerModeForRow: TimerMode | null = null
	if (input.type === "drill" && input.timerMode !== undefined) {
		timerModeForRow = input.timerMode
	}

	// subTypeId is NULL for diagnostic/full_length/simulation; required for drill.
	let subTypeForRow: SubTypeId | null = null
	if (input.type === "drill" && input.subTypeId !== undefined) {
		subTypeForRow = input.subTypeId
	}

	const insertResult = await errors.try(
		db
			.insert(practiceSessions)
			.values({
				userId: input.userId,
				type: input.type,
				subTypeId: subTypeForRow,
				timerMode: timerModeForRow,
				targetQuestionCount: target,
				startedAtMs: nowMs,
				lastHeartbeatMs: nowMs,
				recencyExcludedItemIds: recencyExcluded,
				narrowingRampCompleted: input.ifThenPlan !== undefined,
				ifThenPlan: input.ifThenPlan
			})
			.returning({ id: practiceSessions.id })
	)
	if (insertResult.error) {
		logger.error(
			{ error: insertResult.error, userId: input.userId, type: input.type },
			"startSession: insert failed"
		)
		throw errors.wrap(insertResult.error, "startSession insert")
	}
	const inserted = insertResult.data[0]
	if (!inserted) {
		logger.error(
			{ userId: input.userId, type: input.type },
			"startSession: insert returning empty"
		)
		throw errors.wrap(ErrSessionInsertFailed, `user '${input.userId}' type '${input.type}'`)
	}

	const sessionId = inserted.id

	logger.info(
		{
			sessionId,
			userId: input.userId,
			type: input.type,
			subTypeId: subTypeForRow,
			targetQuestionCount: target,
			recencyExcludedCount: recencyExcluded.length
		},
		"startSession: inserted"
	)

	const firstItem = await getNextItem(sessionId)
	if (!firstItem) {
		logger.error({ sessionId, type: input.type }, "startSession: no first item selectable")
		throw errors.wrap(ErrFirstItemMissing, `session '${sessionId}'`)
	}
	return { sessionId, firstItem }
}

export type { DrillLength, SessionType, StartSessionInput, StartSessionResult, TimerMode }
export { ErrFirstItemMissing, ErrInvalidStartInput, ErrSessionInsertFailed, startSession }
