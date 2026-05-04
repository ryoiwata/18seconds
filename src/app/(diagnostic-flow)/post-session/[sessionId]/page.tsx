// /post-session/[sessionId] — diagnostic-only post-session capture.
//
// Plan: docs/plans/phase3-diagnostic-flow.md §6.
//
// Server component:
//   1. Resolves params to a sessionId promise.
//   2. Loads the session row + auth check.
//   3. Redirects non-diagnostic sessions to / and unauthorized access to /.
//   4. Derives a `pacingMinutes` value from `MAX(attempts.id)`'s UUIDv7
//      timestamp prefix minus `practice_sessions.started_at_ms`. The value
//      is undefined when the session ran ≤ 15 minutes (no pacing line
//      surfaces); when ≥ 15 minutes, the rounded minute count drives the
//      neutral pacing-line sentence rendered by <PostSessionShell>.
//   5. Passes the promise to <PostSessionContent> (a client component)
//      which consumes it via React.use() and renders the shell + form.
//
// The `diagnostic_overtime_note_shown_at_ms` column on practice_sessions
// is left vestigial-and-unread under sub-phase 1 (plan §10). The pacing
// line is derived from attempts data on every load; no DB write is
// involved.

import { eq, sql } from "drizzle-orm"
import { redirect } from "next/navigation"
import * as React from "react"
import { auth } from "@/auth"
import { db } from "@/db"
import { attempts } from "@/db/schemas/practice/attempts"
import { practiceSessions } from "@/db/schemas/practice/practice-sessions"
import { timestampFromUuidv7 } from "@/db/lib/uuid-time"
import { logger } from "@/logger"
import { PostSessionContent } from "@/app/(diagnostic-flow)/post-session/[sessionId]/content"

interface PageProps {
	params: Promise<{ sessionId: string }>
}

interface SessionInfo {
	sessionId: string
	pacingMinutes?: number
}

// Threshold: the real CCAT is 15 minutes for 50 questions. Sessions at
// or under this duration are on-pace and surface no pacing line. Above
// it, the pacing line surfaces with the rounded minute count.
const PACING_THRESHOLD_MS = 15 * 60_000

async function loadSession(sessionIdPromise: Promise<string>): Promise<SessionInfo> {
	const sessionId = await sessionIdPromise
	const session = await auth()
	if (!session?.user?.id) {
		logger.debug({ sessionId }, "/post-session: no auth session, redirect /login")
		redirect("/login")
	}
	const userId = session.user.id

	const rows = await db
		.select({
			id: practiceSessions.id,
			userId: practiceSessions.userId,
			type: practiceSessions.type,
			startedAtMs: practiceSessions.startedAtMs,
			endedAtMs: practiceSessions.endedAtMs
		})
		.from(practiceSessions)
		.where(eq(practiceSessions.id, sessionId))
		.limit(1)

	const row = rows[0]
	if (!row) {
		logger.warn({ sessionId, userId }, "/post-session: session not found, redirect /")
		redirect("/")
	}
	if (row.userId !== userId) {
		logger.warn(
			{ sessionId, userId, ownerUserId: row.userId },
			"/post-session: not owner, redirect /"
		)
		redirect("/")
	}
	if (row.type !== "diagnostic") {
		// Drills don't route through /post-session in Phase 3.
		logger.info({ sessionId, type: row.type }, "/post-session: non-diagnostic, redirect /")
		redirect("/")
	}

	// Derive the pacing-line input from attempts. We want the
	// chronologically-latest attempt's creation time minus
	// started_at_ms. Two notes on the SQL shape:
	//
	//   - The attempts table has no created_at_ms column (project rule
	//     no-timestamp-columns). Every PK is a UUIDv7 whose first 48
	//     bits encode unix-millisecond time, so MAX(id) = latest attempt.
	//   - PG has no built-in max(uuid). Casting id to text and taking
	//     max(text) works because UUIDv7's hex-text lex order matches its
	//     byte/time order. The plan executes via attempts_session_id_idx
	//     and aggregates over the session's at-most-50 rows (verified
	//     with EXPLAIN ANALYZE during commit 3 development).
	const lastAttemptRows = await db
		.select({
			lastAttemptId: sql<string | null>`max(${attempts.id}::text)::uuid`
		})
		.from(attempts)
		.where(eq(attempts.sessionId, row.id))

	const lastAttemptRow = lastAttemptRows[0]
	let pacingMinutes: number | undefined
	if (lastAttemptRow?.lastAttemptId) {
		const lastAttemptMs = timestampFromUuidv7(lastAttemptRow.lastAttemptId).getTime()
		const elapsedMs = lastAttemptMs - row.startedAtMs
		if (elapsedMs > PACING_THRESHOLD_MS) {
			pacingMinutes = Math.round(elapsedMs / 60_000)
		}
	}

	return {
		sessionId: row.id,
		pacingMinutes
	}
}

function Page(props: PageProps) {
	const sessionIdPromise = props.params.then(function pickId(p) {
		return p.sessionId
	})
	const sessionPromise = loadSession(sessionIdPromise)
	return (
		<React.Suspense fallback={<PostSessionSkeleton />}>
			<PostSessionContent sessionPromise={sessionPromise} />
		</React.Suspense>
	)
}

function PostSessionSkeleton() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-xl items-center justify-center px-6">
			<p className="text-muted-foreground text-sm">Loading session…</p>
		</main>
	)
}

export type { SessionInfo }
export default Page
