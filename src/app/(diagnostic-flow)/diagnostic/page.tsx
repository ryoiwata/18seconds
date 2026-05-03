// /diagnostic — server component entry.
//
// Plan §6.1 (flow) + §9.4 (in-progress-stale-finalize edge cases).
//
// Before kicking off `startSession`, we look for any prior diagnostic
// session for this user that is still `ended_at_ms IS NULL`. Per
// plan §9.4, two edge cases land here:
//
//   - User started a diagnostic, navigated away, and returned. The (app)
//     layout's gate failed (no completed diagnostic), redirected here.
//     The orphan in-progress row needs to be finalized as 'abandoned'
//     before we start a fresh diagnostic.
//
//   - User closed the tab and returned BEFORE the abandon-sweep cron
//     finalized the orphan. Same shape; same fix.
//
// Phase 3 ships abandon-then-restart (the simpler choice). Resume is a
// Phase 5 polish item.
//
// The `startSession` action is initiated as a promise here and passed
// through to <DiagnosticContent> (a client component) which consumes it
// via React.use() — the promise-drilling pattern from
// rules/rsc-data-fetching-patterns.md. The page itself is non-async.

import { and, eq, isNull, sql } from "drizzle-orm"
import * as React from "react"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { db } from "@/db"
import { practiceSessions } from "@/db/schemas/practice/practice-sessions"
import { logger } from "@/logger"
import { startSession } from "@/server/sessions/start"
import { DiagnosticContent } from "@/app/(diagnostic-flow)/diagnostic/content"

async function abandonInProgressDiagnosticsAndStart(): Promise<{
	sessionId: string
	firstItem: Awaited<ReturnType<typeof startSession>>["firstItem"]
}> {
	const session = await auth()
	if (!session?.user?.id) {
		// (diagnostic-flow) layout already gates on auth, so this is the
		// "session expired between layout render and page render" path.
		// Redirect to /login so the user re-authenticates.
		logger.debug({}, "/diagnostic: no auth session at page time, redirect /login")
		redirect("/login")
	}
	const userId = session.user.id

	// Finalize any orphan in-progress diagnostic. Per plan §9.4, one
	// query covers both the "in-progress" and "recently-abandoned-but-
	// not-swept" cases — the WHERE clause is the same.
	const finalized = await db
		.update(practiceSessions)
		.set({
			endedAtMs: sql`(extract(epoch from now()) * 1000)::bigint`,
			completionReason: "abandoned"
		})
		.where(
			and(
				eq(practiceSessions.userId, userId),
				eq(practiceSessions.type, "diagnostic"),
				isNull(practiceSessions.endedAtMs)
			)
		)
		.returning({ id: practiceSessions.id })

	if (finalized.length > 0) {
		logger.info(
			{ userId, count: finalized.length },
			"/diagnostic: finalized stale in-progress diagnostic(s) before fresh start"
		)
	}

	return startSession({ userId, type: "diagnostic" })
}

function Page() {
	const sessionPromise = abandonInProgressDiagnosticsAndStart()
	return (
		<React.Suspense fallback={<DiagnosticSkeleton />}>
			<DiagnosticContent sessionPromise={sessionPromise} />
		</React.Suspense>
	)
}

function DiagnosticSkeleton() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-xl items-center justify-center px-6">
			<p className="text-muted-foreground text-sm">Preparing your diagnostic…</p>
		</main>
	)
}

export default Page
