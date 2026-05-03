"use client"

// <PostSessionShell> — minimal post-session shell.
//
// Plan §6.2. Phase 3's post-session is intentionally thin: target
// percentile + target date capture, plus a one-line overtime note IFF
// `practice_sessions.diagnostic_overtime_note_shown_at_ms` is set
// (i.e., the diagnostic crossed the 15-minute mark). The full Phase 5
// post-session composition (wrong-items list, accuracy/latency summary,
// strategy surfacing) lives outside this shell and ships later.

import type * as React from "react"
import { OnboardingTargets } from "@/components/post-session/onboarding-targets"

interface PostSessionShellProps {
	overtimeNoteShown: boolean
}

function PostSessionShell(props: PostSessionShellProps) {
	let overtimeLine: React.ReactNode = null
	if (props.overtimeNoteShown) {
		overtimeLine = (
			<p className="text-muted-foreground text-sm">
				You went past the 15-minute real-test window. Calibration is unaffected;
				keep the result in mind when you sit the actual test.
			</p>
		)
	}

	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-12">
			<header className="space-y-2">
				<h1 className="font-semibold text-2xl tracking-tight">Diagnostic complete</h1>
				<p className="text-muted-foreground text-sm">
					Tell us what you're aiming for so we can pace your practice.
				</p>
			</header>
			<OnboardingTargets />
			{overtimeLine}
		</main>
	)
}

export { PostSessionShell }
