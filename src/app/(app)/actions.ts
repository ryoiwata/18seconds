"use server"

// Phase 3 server actions. Thin wrappers over the underlying functions
// in src/server/sessions/* and src/server/mastery/*. Each action:
//   1. Resolves the user via auth() (or throws ErrUnauthorized).
//   2. Validates the input shape via Zod.
//   3. Calls the underlying function.
//   4. revalidatePath after writes (the per-action policy is described
//      below action-by-action).
//
// This wrapper always invokes the underlying endSession with default
// options — the workflow-trigger always fires. The dev/test escape hatch
// (see src/server/sessions/end.ts) is reachable only by direct import
// from a script, never from this surface. See plan §10 commit 1.

import * as errors from "@superbuilders/errors"
import { revalidatePath } from "next/cache"
import { eq, sql } from "drizzle-orm"
import { z } from "zod"
import { auth } from "@/auth"
import { subTypeIds } from "@/config/sub-types"
import { db } from "@/db"
import { users } from "@/db/schemas/auth/users"
import { practiceSessions } from "@/db/schemas/practice/practice-sessions"
import { logger } from "@/logger"
import * as sessionEnd from "@/server/sessions/end"
import * as sessionStart from "@/server/sessions/start"
import type { StartSessionInput, StartSessionResult } from "@/server/sessions/start"
import * as sessionSubmit from "@/server/sessions/submit"
import type { SubmitAttemptInput, SubmitAttemptResult } from "@/server/sessions/submit"

const ErrUnauthorized = errors.new("unauthorized")
const ErrInvalidActionInput = errors.new("invalid action input")

const startSessionInputSchema = z.object({
	type: z.enum(["diagnostic", "drill", "full_length", "simulation", "review"]),
	subTypeId: z.enum(subTypeIds).optional(),
	timerMode: z.enum(["standard", "speed_ramp", "brutal"]).optional(),
	drillLength: z.union([z.literal(5), z.literal(10), z.literal(20)]).optional(),
	ifThenPlan: z.string().min(1).max(2048).optional()
})

type StartSessionActionInput = Omit<StartSessionInput, "userId">

async function requireUserId(): Promise<string> {
	const session = await auth()
	if (!session?.user?.id) {
		logger.warn("action: no auth session")
		throw errors.wrap(ErrUnauthorized, "no session")
	}
	return session.user.id
}

async function startSession(input: StartSessionActionInput): Promise<StartSessionResult> {
	const parsed = startSessionInputSchema.safeParse(input)
	if (!parsed.success) {
		logger.error({ issues: parsed.error.issues }, "startSession action: input invalid")
		throw errors.wrap(ErrInvalidActionInput, "startSession input")
	}
	const userId = await requireUserId()
	return sessionStart.startSession({ userId, ...parsed.data })
}

const submitAttemptInputSchema = z.object({
	sessionId: z.string().uuid(),
	itemId: z.string().uuid(),
	selectedAnswer: z.string().min(1).optional(),
	latencyMs: z.number().int().nonnegative(),
	triagePromptFired: z.boolean(),
	triageTaken: z.boolean(),
	selection: z.object({
		servedAtTier: z.enum(["easy", "medium", "hard", "brutal"]),
		fallbackFromTier: z.enum(["easy", "medium", "hard", "brutal"]).optional(),
		fallbackLevel: z.enum(["fresh", "session-soft", "recency-soft", "tier-degraded"])
	})
})

async function assertSessionOwnedBy(sessionId: string, userId: string): Promise<void> {
	const result = await errors.try(
		db
			.select({ userId: practiceSessions.userId })
			.from(practiceSessions)
			.where(eq(practiceSessions.id, sessionId))
			.limit(1)
	)
	if (result.error) {
		logger.error(
			{ error: result.error, sessionId, userId },
			"assertSessionOwnedBy: read failed"
		)
		throw errors.wrap(result.error, "assertSessionOwnedBy")
	}
	const row = result.data[0]
	if (!row || row.userId !== userId) {
		logger.warn(
			{ sessionId, userId, ownerUserId: row?.userId },
			"assertSessionOwnedBy: session not owned by user"
		)
		throw errors.wrap(ErrUnauthorized, `session id '${sessionId}'`)
	}
}

async function submitAttempt(input: SubmitAttemptInput): Promise<SubmitAttemptResult> {
	const parsed = submitAttemptInputSchema.safeParse(input)
	if (!parsed.success) {
		logger.error({ issues: parsed.error.issues }, "submitAttempt action: input invalid")
		throw errors.wrap(ErrInvalidActionInput, "submitAttempt input")
	}
	const userId = await requireUserId()
	await assertSessionOwnedBy(parsed.data.sessionId, userId)
	return sessionSubmit.submitAttempt(parsed.data)
}

async function endSession(sessionId: string): Promise<void> {
	const userId = await requireUserId()
	await assertSessionOwnedBy(sessionId, userId)
	// Default options — workflow trigger always fires. See file header.
	await sessionEnd.endSession(sessionId)
	revalidatePath(`/post-session/${sessionId}`)
}

const overtimeInputSchema = z.object({
	sessionId: z.string().uuid()
})

async function recordDiagnosticOvertimeNote(input: { sessionId: string }): Promise<void> {
	const parsed = overtimeInputSchema.safeParse(input)
	if (!parsed.success) {
		logger.error({ issues: parsed.error.issues }, "recordOvertime: input invalid")
		throw errors.wrap(ErrInvalidActionInput, "recordDiagnosticOvertimeNote input")
	}
	const userId = await requireUserId()
	await assertSessionOwnedBy(parsed.data.sessionId, userId)
	// Idempotent: only update when the column is still NULL. A second call
	// (e.g., a stray re-render firing the effect twice) is a silent no-op.
	const result = await errors.try(
		db
			.update(practiceSessions)
			.set({
				diagnosticOvertimeNoteShownAtMs: sql`(extract(epoch from now()) * 1000)::bigint`
			})
			.where(
				sql`${practiceSessions.id} = ${parsed.data.sessionId} AND ${practiceSessions.diagnosticOvertimeNoteShownAtMs} IS NULL`
			)
			.returning({ id: practiceSessions.id })
	)
	if (result.error) {
		logger.error(
			{ error: result.error, sessionId: parsed.data.sessionId },
			"recordDiagnosticOvertimeNote: update failed"
		)
		throw errors.wrap(result.error, "recordDiagnosticOvertimeNote")
	}
	if (result.data.length === 0) {
		// Already recorded — fine, just info.
		logger.info(
			{ sessionId: parsed.data.sessionId },
			"recordDiagnosticOvertimeNote: already recorded (no-op)"
		)
		return
	}
	logger.info(
		{ sessionId: parsed.data.sessionId },
		"recordDiagnosticOvertimeNote: timestamp written"
	)
}

const allowedPercentiles = [50, 30, 20, 10, 5] as const
const onboardingTargetsSchema = z.object({
	targetPercentile: z
		.union([
			z.literal(50),
			z.literal(30),
			z.literal(20),
			z.literal(10),
			z.literal(5)
		])
		.optional(),
	targetDateMs: z.number().int().positive().optional()
})

async function saveOnboardingTargets(input: {
	targetPercentile?: (typeof allowedPercentiles)[number]
	targetDateMs?: number
}): Promise<void> {
	const parsed = onboardingTargetsSchema.safeParse(input)
	if (!parsed.success) {
		logger.error({ issues: parsed.error.issues }, "saveOnboardingTargets: input invalid")
		throw errors.wrap(ErrInvalidActionInput, "saveOnboardingTargets input")
	}
	const userId = await requireUserId()
	const updateValues: { targetPercentile?: number; targetDateMs?: number } = {}
	if (parsed.data.targetPercentile !== undefined) {
		updateValues.targetPercentile = parsed.data.targetPercentile
	}
	if (parsed.data.targetDateMs !== undefined) {
		updateValues.targetDateMs = parsed.data.targetDateMs
	}
	if (Object.keys(updateValues).length === 0) {
		// Skip-for-now path. Nothing to write; just log.
		logger.info({ userId }, "saveOnboardingTargets: no fields supplied (skip-for-now)")
		revalidatePath("/")
		return
	}
	const result = await errors.try(
		db.update(users).set(updateValues).where(eq(users.id, userId))
	)
	if (result.error) {
		logger.error({ error: result.error, userId }, "saveOnboardingTargets: update failed")
		throw errors.wrap(result.error, "saveOnboardingTargets")
	}
	logger.info(
		{
			userId,
			targetPercentile: parsed.data.targetPercentile,
			targetDateMs: parsed.data.targetDateMs
		},
		"saveOnboardingTargets: targets persisted"
	)
	revalidatePath("/")
}

export {
	endSession,
	recordDiagnosticOvertimeNote,
	saveOnboardingTargets,
	startSession,
	submitAttempt
}
