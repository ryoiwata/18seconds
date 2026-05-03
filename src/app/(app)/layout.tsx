// (app) route-group layout — auth + diagnostic-completed gate.
//
// Plan §6.5. Routes inside this group (/, /drill/...) require both:
//   1. A signed-in user (via NextAuth's auth()).
//   2. At least one practice_sessions row of type='diagnostic' with
//      ended_at_ms NOT NULL AND completion_reason != 'abandoned'.
//
// The diagnostic flow itself lives in the sibling (diagnostic-flow)
// group, which carries the auth gate but NOT the diagnostic-completed
// gate — that's how a user who's never finished the diagnostic can
// reach /diagnostic without an infinite redirect loop.
//
// This layout is a Server Component (no async per
// rules/rsc-data-fetching-patterns.md), so the auth() + gate query are
// initiated as promises and awaited at the call site of `redirect`.
// `redirect` throws — the client never sees the layout body when a
// gate fails.

import { and, eq, isNotNull, ne, sql } from "drizzle-orm"
import { redirect } from "next/navigation"
import * as React from "react"
import { auth } from "@/auth"
import { db } from "@/db"
import { practiceSessions } from "@/db/schemas/practice/practice-sessions"
import { logger } from "@/logger"

async function requireDiagnosticGate(): Promise<void> {
	const session = await auth()
	if (!session?.user?.id) {
		logger.debug({}, "(app) layout: no auth session, redirect /login")
		redirect("/login")
	}
	const userId = session.user.id

	const completed = await db
		.select({ ok: sql<number>`1` })
		.from(practiceSessions)
		.where(
			and(
				eq(practiceSessions.userId, userId),
				eq(practiceSessions.type, "diagnostic"),
				isNotNull(practiceSessions.endedAtMs),
				ne(practiceSessions.completionReason, "abandoned")
			)
		)
		.limit(1)

	if (completed.length === 0) {
		logger.info({ userId }, "(app) layout: no completed diagnostic, redirect /diagnostic")
		redirect("/diagnostic")
	}
}

function AppLayout(props: { children: React.ReactNode }) {
	const gatePromise = requireDiagnosticGate()
	return (
		<React.Suspense fallback={null}>
			<AppLayoutInner gatePromise={gatePromise}>{props.children}</AppLayoutInner>
		</React.Suspense>
	)
}

// Inner component is `async` only to await the gate promise. This keeps
// the outer `AppLayout` synchronous (matches the rsc-data-fetching-patterns
// rule that the page-level component is non-async); the inner is the
// canonical "gate then render children" shape. The Suspense above is
// required by next.config.ts's `cacheComponents: true` — uncached
// awaits must live inside a Suspense boundary.
async function AppLayoutInner(props: {
	gatePromise: Promise<void>
	children: React.ReactNode
}) {
	await props.gatePromise
	return props.children
}

export default AppLayout
