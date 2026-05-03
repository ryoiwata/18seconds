// Triage adherence scoring per docs/plans/phase-3-practice-surface.md §4.5.
//
// Reads the dedicated `attempts.triage_prompt_fired` and
// `attempts.triage_taken` boolean columns directly — NOT nested inside
// `metadata_json`. The native columns let triageRolling30d reduce to a
// single indexed scan over (attempts joined to practice_sessions).
//
// Both functions return the same shape `{ fired, taken, ratio }` per
// SPEC §9.7. `ratio` is null when `fired < 3` (small-sample branch); the
// renderer surfaces a "small sample — N triage events" string instead of
// a percentage.

import * as errors from "@superbuilders/errors"
import { eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { attempts } from "@/db/schemas/practice/attempts"
import { practiceSessions } from "@/db/schemas/practice/practice-sessions"
import { uuidv7LowerBound } from "@/db/lib/uuid-time"
import { logger } from "@/logger"

const ROLLING_WINDOW_MS = 30 * 86_400_000
const SMALL_SAMPLE_THRESHOLD = 3

interface TriageScore {
	fired: number
	taken: number
	ratio: number | null
}

function ratioFor(fired: number, taken: number): number | null {
	if (fired < SMALL_SAMPLE_THRESHOLD) return null
	return taken / fired
}

async function triageScoreForSession(sessionId: string): Promise<TriageScore> {
	const result = await errors.try(
		db
			.select({
				fired: sql<number>`COALESCE(SUM(CASE WHEN ${attempts.triagePromptFired} THEN 1 ELSE 0 END), 0)::int`,
				taken: sql<number>`COALESCE(SUM(CASE WHEN ${attempts.triageTaken} THEN 1 ELSE 0 END), 0)::int`
			})
			.from(attempts)
			.where(eq(attempts.sessionId, sessionId))
	)
	if (result.error) {
		logger.error(
			{ error: result.error, sessionId },
			"triageScoreForSession: query failed"
		)
		throw errors.wrap(result.error, "triageScoreForSession")
	}
	const row = result.data[0]
	if (!row) {
		logger.warn({ sessionId }, "triageScoreForSession: empty aggregate result")
		return { fired: 0, taken: 0, ratio: null }
	}
	return { fired: row.fired, taken: row.taken, ratio: ratioFor(row.fired, row.taken) }
}

async function triageRolling30d(userId: string): Promise<TriageScore> {
	const lowerBound = uuidv7LowerBound(new Date(Date.now() - ROLLING_WINDOW_MS))
	const result = await errors.try(
		db
			.select({
				fired: sql<number>`COALESCE(SUM(CASE WHEN ${attempts.triagePromptFired} THEN 1 ELSE 0 END), 0)::int`,
				taken: sql<number>`COALESCE(SUM(CASE WHEN ${attempts.triageTaken} THEN 1 ELSE 0 END), 0)::int`
			})
			.from(attempts)
			.innerJoin(practiceSessions, eq(attempts.sessionId, practiceSessions.id))
			.where(
				sql`${practiceSessions.userId} = ${userId} AND ${attempts.id} >= ${lowerBound}::uuid`
			)
	)
	if (result.error) {
		logger.error(
			{ error: result.error, userId },
			"triageRolling30d: query failed"
		)
		throw errors.wrap(result.error, "triageRolling30d")
	}
	const row = result.data[0]
	if (!row) {
		logger.warn({ userId }, "triageRolling30d: empty aggregate result")
		return { fired: 0, taken: 0, ratio: null }
	}
	return { fired: row.fired, taken: row.taken, ratio: ratioFor(row.fired, row.taken) }
}

export type { TriageScore }
export { triageRolling30d, triageScoreForSession }
