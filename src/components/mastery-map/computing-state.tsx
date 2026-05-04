"use client"

// <ComputingState> — empty-state pane rendered when the user has a
// completed-non-abandoned diagnostic (the (app) gate passed) but
// mastery_state has zero rows for them. Plan
// docs/plans/phase3-mastery-map.md §3.
//
// Why this exists: endSession fires masteryRecomputeWorkflow async,
// then the user is pushed through /post-session to /. The race window
// between the post-session redirect and mastery_state being populated
// is short (~1.1s on dev DB; expected up to 10–15s on production cold
// starts), but it's the COMMON path for a fresh user — they're fast,
// the workflow is async. Without this pane, they'd see eleven
// "not yet attempted" outlined icons that misrepresent their state.
//
// Polling shape: setTimeout 2s → router.refresh() → parent re-renders;
// if mastery_state has populated, the parent branches to the populated
// MasteryMap and this component unmounts; if still empty, this
// component re-mounts and the cycle repeats. Hard 30-second budget per
// mount instance (the timeout window resets on each refresh, which is
// acceptable — the rare "stuck workflow" case shows the computing
// state indefinitely, which is recoverable via manual refresh).
//
// No fancy skeleton; the parent's <React.Suspense> fallback (a single
// "Loading…" line) covers the brief navigation interval, and this
// component covers the post-navigation race.

import * as React from "react"
import { useRouter } from "next/navigation"

const POLL_INTERVAL_MS = 2000
const POLL_BUDGET_MS = 30_000

function ComputingState() {
	const router = useRouter()
	const [timedOut, setTimedOut] = React.useState(false)

	React.useEffect(
		function pollMasteryState() {
			const startMs = Date.now()
			let timeoutId: ReturnType<typeof setTimeout> | undefined

			function tick(): void {
				const elapsed = Date.now() - startMs
				if (elapsed >= POLL_BUDGET_MS) {
					setTimedOut(true)
					return
				}
				router.refresh()
				timeoutId = setTimeout(tick, POLL_INTERVAL_MS)
			}

			timeoutId = setTimeout(tick, POLL_INTERVAL_MS)

			return function cleanup() {
				if (timeoutId !== undefined) clearTimeout(timeoutId)
			}
		},
		[router]
	)

	let body = (
		<p className="text-muted-foreground text-sm">
			This usually takes a few seconds. The page will refresh automatically.
		</p>
	)
	if (timedOut) {
		body = (
			<p className="text-muted-foreground text-sm">
				Still computing. Refresh manually if this takes longer.
			</p>
		)
	}

	return (
		<main
			className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-4 px-6 py-12"
			data-testid="mastery-map-computing-state"
		>
			<h1 className="font-semibold text-2xl tracking-tight">We're computing your mastery state…</h1>
			{body}
		</main>
	)
}

export { ComputingState }
