// (diagnostic-flow) route-group layout — auth ONLY.
//
// Plan §6.5. This layout wraps /diagnostic and /post-session/[sessionId]
// and carries the auth gate but NOT the diagnostic-completed gate. That's
// what lets a user who's never finished the diagnostic reach /diagnostic
// without an infinite redirect loop.
//
// Mirrors the (app)/layout.tsx pattern: outer sync component initiates a
// gate promise, inner async component awaits it (redirect() throws to
// short-circuit before the children render).

import { redirect } from "next/navigation"
import * as React from "react"
import { auth } from "@/auth"
import { logger } from "@/logger"

async function requireAuth(): Promise<void> {
	const session = await auth()
	if (!session?.user?.id) {
		logger.debug({}, "(diagnostic-flow) layout: no auth session, redirect /login")
		redirect("/login")
	}
}

function DiagnosticFlowLayout(props: { children: React.ReactNode }) {
	const gatePromise = requireAuth()
	return (
		<React.Suspense fallback={null}>
			<Inner gatePromise={gatePromise}>{props.children}</Inner>
		</React.Suspense>
	)
}

// Inner is async only to await the gate promise; the Suspense above
// is required by next.config.ts's `cacheComponents: true` — uncached
// awaits must live inside a Suspense boundary.
async function Inner(props: { gatePromise: Promise<void>; children: React.ReactNode }) {
	await props.gatePromise
	return props.children
}

export default DiagnosticFlowLayout
