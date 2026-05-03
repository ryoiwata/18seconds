// Heartbeat route — Plan §1.8 / §7.1.
//
// The <Heartbeat> client component fires `navigator.sendBeacon` here every
// 30 seconds plus once on `pagehide`. The handler bumps
// `practice_sessions.last_heartbeat_ms` and returns 204.
//
// Idempotent on the row: the WHERE clause includes `ended_at_ms IS NULL`
// so a heartbeat that races with `endSession` (the action committing
// completion) or with the abandon-sweep cron (committing abandonment)
// silently no-ops on the already-ended row. Returns 204 either way to
// avoid leaking session existence to a curl-with-known-id probe.
//
// No auth() call — the route is on the public side of the proxy
// (matcher carve-out in src/proxy.ts). Per plan §7.1 / §7.2, the
// proxy carve-out is what makes this cheap enough to call 120× per
// session without paying a per-30s DB hit on the auth_sessions table.

import * as errors from "@superbuilders/errors"
import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { practiceSessions } from "@/db/schemas/practice/practice-sessions"
import { logger } from "@/logger"

interface RouteContext {
	params: Promise<{ sessionId: string }>
}

async function POST(_req: Request, ctx: RouteContext): Promise<Response> {
	const params = await ctx.params
	const sessionId = params.sessionId
	const result = await errors.try(
		db
			.update(practiceSessions)
			.set({ lastHeartbeatMs: sql`(extract(epoch from now()) * 1000)::bigint` })
			.where(
				and(eq(practiceSessions.id, sessionId), isNull(practiceSessions.endedAtMs))
			)
			.returning({ id: practiceSessions.id })
	)
	if (result.error) {
		// Log but still return 204 — the beacon is fire-and-forget from the
		// client; surfacing a 5xx here doesn't help anyone and risks
		// retry storms on a flaky DB.
		logger.error({ error: result.error, sessionId }, "heartbeat: update failed")
		return new Response(null, { status: 204 })
	}
	if (result.data.length === 0) {
		// Either the session does not exist or it is already ended. Both
		// cases are recoverable; log at debug and 204 silently.
		logger.debug({ sessionId }, "heartbeat: row missing or already ended")
		return new Response(null, { status: 204 })
	}
	logger.debug({ sessionId }, "heartbeat: bumped")
	return new Response(null, { status: 204 })
}

export { POST }
