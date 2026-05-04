// Next-tier-side-effect test for the mastery recompute workflow.
//
// Plan: docs/plans/phase3-diagnostic-flow.md §5.2 (folded into commit 4).
//
// Why this test exists:
//
//   The mastery recompute workflow fires from two writers — endSession
//   (server action, normal completion) and the abandon-sweep cron route
//   (stale finalization). Both invoke `start(masteryRecomputeWorkflow,
//   [{sessionId}])`. The Vercel workflow runtime is wired via
//   `withWorkflow` in next.config.ts and is only loaded inside the
//   Next.js server process. Calling `start()` from outside that
//   process fails with "invalid workflow function."
//
//   The pattern from the focus-shell post-overhaul round (per Plan
//   §5.2) is: don't assert the workflow fires; assert its observable
//   downstream effect. Concretely: after the trigger, mastery_state
//   rows must exist for every distinct sub-type touched in the
//   finalized session, and updated_at_ms must be recent.
//
// Trigger surface used here:
//
//   The dev Next.js server (localhost:3000) hosts the abandon-sweep
//   route, which IS reachable via HTTP and which IS inside the
//   workflow runtime's Next.js context. POSTing to /api/cron/abandon-
//   sweep with bearer auth fires the same workflow that endSession
//   would fire on session completion. The test exercises this path
//   because it's the only HTTP-accessible workflow trigger today.
//
//   If the dev server isn't running on localhost:3000, this test fails
//   loudly at the fetch step rather than skipping silently — the
//   environmental dependency is intentional and the failure surfaces
//   it clearly.
//
// What the test asserts:
//
//   1. After cron POST, mastery_state contains exactly one row per
//      distinct sub-type touched in the finalized session.
//   2. Each row's updated_at_ms is within 30 seconds of the cron POST.
//
// 30s budget rationale: the dev workflow runtime queues async; in
// practice the trigger-to-upsert path completed in ~1s during the
// commit-4 verification probe. 30s is a generous ceiling.

import "@/env"
import { expect, test } from "bun:test"
import * as errors from "@superbuilders/errors"
import { and, eq, sql } from "drizzle-orm"
import { createAdminDb } from "@/db/admin"
import { attempts } from "@/db/schemas/practice/attempts"
import { items } from "@/db/schemas/catalog/items"
import { masteryState } from "@/db/schemas/practice/mastery-state"
import { practiceSessions } from "@/db/schemas/practice/practice-sessions"
import { users } from "@/db/schemas/auth/users"
import { env } from "@/env"
import { logger } from "@/logger"

const DEV_SERVER_URL = "http://localhost:3000"
const POLL_INTERVAL_MS = 500
const POLL_TIMEOUT_MS = 30_000

const ErrUserInsertEmpty = errors.new("recompute-side-effect: user insert returned no rows")
const ErrSessionInsertEmpty = errors.new("recompute-side-effect: session insert returned no rows")
const ErrLiveItemMissing = errors.new("recompute-side-effect: dev DB missing a required live item")
const ErrPollTimeout = errors.new("recompute-side-effect: timed out waiting for mastery_state rows")

interface SetupResult {
	userId: string
	sessionId: string
	touchedSubTypes: string[]
}

async function setupStaleSessionWithAttempts(): Promise<SetupResult> {
	await using adminDb = await createAdminDb()

	const userInsert = await errors.try(
		adminDb.db
			.insert(users)
			.values({
				email: `recompute-side-effect-${Date.now()}@local.dev`,
				name: "Recompute Side Effect Test"
			})
			.returning({ id: users.id })
	)
	if (userInsert.error) {
		logger.error({ error: userInsert.error }, "recompute-side-effect: user insert failed")
		throw errors.wrap(userInsert.error, "user insert")
	}
	const u = userInsert.data[0]
	if (!u) {
		logger.error({}, "recompute-side-effect: user insert returned no rows")
		throw ErrUserInsertEmpty
	}
	const userId = u.id

	// Stale (last_heartbeat 6 min ago, > the 5-minute abandon threshold).
	const sessionInsert = await errors.try(
		adminDb.db
			.insert(practiceSessions)
			.values({
				userId,
				type: "diagnostic",
				targetQuestionCount: 50,
				startedAtMs: sql`(extract(epoch from now()) * 1000)::bigint - (10 * 60 * 1000)`,
				lastHeartbeatMs: sql`(extract(epoch from now()) * 1000)::bigint - (6 * 60 * 1000)`,
				recencyExcludedItemIds: []
			})
			.returning({ id: practiceSessions.id })
	)
	if (sessionInsert.error) {
		logger.error(
			{ error: sessionInsert.error, userId },
			"recompute-side-effect: session insert failed"
		)
		throw errors.wrap(sessionInsert.error, "session insert")
	}
	const sess = sessionInsert.data[0]
	if (!sess) {
		logger.error({ userId }, "recompute-side-effect: session insert returned no rows")
		throw ErrSessionInsertEmpty
	}
	const sessionId = sess.id

	// 3 attempts, each from a different sub-type. Hand-pick three
	// sub-types and fetch one live item from each — typed Drizzle query,
	// no need for raw SQL DISTINCT ON.
	const targetSubTypes = [
		"verbal.synonyms",
		"numerical.fractions",
		"numerical.percentages"
	] as const
	const touchedSubTypes: string[] = []
	for (const subTypeId of targetSubTypes) {
		const itemRows = await errors.try(
			adminDb.db
				.select({ id: items.id })
				.from(items)
				.where(and(eq(items.subTypeId, subTypeId), eq(items.status, "live")))
				.limit(1)
		)
		if (itemRows.error) {
			logger.error(
				{ error: itemRows.error, subTypeId },
				"recompute-side-effect: item pick failed"
			)
			throw errors.wrap(itemRows.error, "item pick")
		}
		const item = itemRows.data[0]
		if (!item) {
			logger.error(
				{ subTypeId },
				"recompute-side-effect: dev DB has no live item in target sub-type"
			)
			throw ErrLiveItemMissing
		}
		touchedSubTypes.push(subTypeId)
		const insertAttempt = await errors.try(
			adminDb.db.insert(attempts).values({
				sessionId,
				itemId: item.id,
				selectedAnswer: "A",
				correct: true,
				latencyMs: 5000,
				servedAtTier: "easy"
			})
		)
		if (insertAttempt.error) {
			logger.error(
				{ error: insertAttempt.error, sessionId, subTypeId },
				"recompute-side-effect: attempt insert failed"
			)
			throw errors.wrap(insertAttempt.error, "attempt insert")
		}
	}

	return { userId, sessionId, touchedSubTypes }
}

async function pollMasteryStateUntilStable(
	userId: string,
	expectedRowCount: number
): Promise<{ rowCount: number; subTypes: string[]; latestUpdatedAtMs: number }> {
	await using adminDb = await createAdminDb()
	const t0 = Date.now()
	while (Date.now() - t0 < POLL_TIMEOUT_MS) {
		const result = await errors.try(
			adminDb.db
				.select({
					subTypeId: masteryState.subTypeId,
					updatedAtMs: masteryState.updatedAtMs
				})
				.from(masteryState)
				.where(eq(masteryState.userId, userId))
		)
		if (result.error) {
			logger.error({ error: result.error, userId }, "recompute-side-effect: mastery_state read failed")
			throw errors.wrap(result.error, "mastery_state read")
		}
		if (result.data.length >= expectedRowCount) {
			let latestUpdatedAtMs = 0
			for (const row of result.data) {
				if (row.updatedAtMs > latestUpdatedAtMs) latestUpdatedAtMs = row.updatedAtMs
			}
			const subTypes = result.data.map(function pickSubType(r) { return r.subTypeId })
			return { rowCount: result.data.length, subTypes, latestUpdatedAtMs }
		}
		await Bun.sleep(POLL_INTERVAL_MS)
	}
	logger.error(
		{ userId, expectedRowCount, timeoutMs: POLL_TIMEOUT_MS },
		"recompute-side-effect: poll timed out before reaching expected row count"
	)
	throw ErrPollTimeout
}

test(
	"masteryRecomputeWorkflow side-effect: mastery_state rows upsert for each distinct sub-type after cron-driven session finalization",
	async function masteryRecomputeSideEffect() {
		const setup = await setupStaleSessionWithAttempts()
		const expectedSubTypeCount = setup.touchedSubTypes.length
		logger.info(
			{ userId: setup.userId, sessionId: setup.sessionId, touchedSubTypes: setup.touchedSubTypes },
			"recompute-side-effect: setup complete"
		)

		const cronPostMs = Date.now()
		const fetchResult = await errors.try(
			fetch(`${DEV_SERVER_URL}/api/cron/abandon-sweep`, {
				method: "POST",
				headers: { authorization: `Bearer ${env.CRON_SECRET}` }
			})
		)
		if (fetchResult.error) {
			logger.error(
				{ error: fetchResult.error },
				"recompute-side-effect: cron POST failed — is the dev server running on localhost:3000?"
			)
			throw errors.wrap(fetchResult.error, "cron POST")
		}
		expect(fetchResult.data.status).toBe(204)

		const observed = await pollMasteryStateUntilStable(setup.userId, expectedSubTypeCount)
		expect(observed.rowCount).toBe(expectedSubTypeCount)
		const observedSet = new Set(observed.subTypes)
		const expectedSet = new Set(setup.touchedSubTypes)
		expect(observedSet).toEqual(expectedSet)

		// updated_at_ms freshness check. The polled rows should have been
		// upserted after our cron POST. Allow a small clock-skew window.
		const updateAgeMs = observed.latestUpdatedAtMs - cronPostMs
		expect(updateAgeMs).toBeGreaterThanOrEqual(-1000) // server clock could be slightly behind
		expect(updateAgeMs).toBeLessThanOrEqual(POLL_TIMEOUT_MS)
	},
	POLL_TIMEOUT_MS + 10_000
)
