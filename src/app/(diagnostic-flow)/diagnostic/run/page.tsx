// /diagnostic/run — server component entry that runs the diagnostic
// session. The pre-diagnostic explainer at /diagnostic links here.
//
// docs/plans/phase3-diagnostic-flow.md §7 + commit 1.
//
// Single source of truth for orphan-in-progress finalization is
// `startSession` (src/server/sessions/start.ts). When this page calls
// `startSession({ userId, type: "diagnostic" })`, the action internally:
//
//   - fresh   (last_heartbeat_ms within ABANDON_THRESHOLD_MS): returns
//             the existing sessionId — fresh-resume path.
//   - stale   (older): finalizes the orphan as 'abandoned' atomically
//             with the fresh insert, writing the cron-compatible shape
//             `ended_at_ms = last_heartbeat_ms + HEARTBEAT_GRACE_MS`.
//
// The previous `abandonInProgressDiagnosticsAndStart` helper that lived
// here unconditionally finalized every in-progress diagnostic with
// `ended_at_ms = NOW()`. That diverged from the cron-compatible shape
// AND prevented fresh-resume from working at all. Collapsed into
// `startSession`'s idempotency in this commit.
//
// `startSession` is initiated as a promise here and passed through to
// <DiagnosticContent> (a client component) which consumes it via
// React.use() — the promise-drilling pattern from
// rules/rsc-data-fetching-patterns.md. The page itself is non-async.

import * as React from "react"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { logger } from "@/logger"
import { startSession } from "@/server/sessions/start"
import { DiagnosticContent } from "@/app/(diagnostic-flow)/diagnostic/run/content"

async function startDiagnosticForCurrentUser(): Promise<{
	sessionId: string
	firstItem: Awaited<ReturnType<typeof startSession>>["firstItem"]
}> {
	const session = await auth()
	if (!session?.user?.id) {
		// (diagnostic-flow) layout already gates on auth, so this is the
		// "session expired between layout render and page render" path.
		// Redirect to /login so the user re-authenticates.
		logger.debug({}, "/diagnostic/run: no auth session at page time, redirect /login")
		redirect("/login")
	}
	return startSession({ userId: session.user.id, type: "diagnostic" })
}

function Page() {
	const sessionPromise = startDiagnosticForCurrentUser()
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
