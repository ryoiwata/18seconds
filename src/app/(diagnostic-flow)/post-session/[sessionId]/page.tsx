// /post-session/[sessionId] — diagnostic-only post-session capture.
//
// Plan §6.2. Server component:
//   1. Resolves params to a sessionId promise.
//   2. Loads the session row + auth check.
//   3. Redirects non-diagnostic sessions to / and unauthorized access to /.
//   4. Surfaces `diagnostic_overtime_note_shown_at_ms` so the client
//      content can decide whether to render the substantive overtime
//      paragraph.
//   5. Passes the promise to <PostSessionContent> (a client component)
//      which consumes it via React.use() and renders the shell + form.

import { eq } from "drizzle-orm"
import { redirect } from "next/navigation"
import * as React from "react"
import { auth } from "@/auth"
import { db } from "@/db"
import { practiceSessions } from "@/db/schemas/practice/practice-sessions"
import { logger } from "@/logger"
import { PostSessionContent } from "@/app/(diagnostic-flow)/post-session/[sessionId]/content"

interface PageProps {
	params: Promise<{ sessionId: string }>
}

interface SessionInfo {
	sessionId: string
	overtimeNoteShown: boolean
}

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
			endedAtMs: practiceSessions.endedAtMs,
			diagnosticOvertimeNoteShownAtMs: practiceSessions.diagnosticOvertimeNoteShownAtMs
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

	return {
		sessionId: row.id,
		overtimeNoteShown: row.diagnosticOvertimeNoteShownAtMs !== null
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
