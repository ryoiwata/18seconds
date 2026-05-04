"use client"

// <PostSessionShell> — minimal post-session shell.
//
// Plan: docs/plans/phase3-diagnostic-flow.md §6. Phase 3's post-session
// is intentionally thin: target percentile + target date capture, plus
// a derived neutral pacing line surfaced when the user took longer than
// 15 minutes. The pacing line is informational, not a judgment — it
// reports the user's diagnostic duration alongside the real-CCAT
// reference (15 minutes for 50 questions) so the user can calibrate
// without being primed by a triage frame the diagnostic isn't training.
//
// The full Phase 5 post-session composition (wrong-items list,
// accuracy/latency summary, strategy surfacing) lives outside this
// shell and ships later.

import type * as React from "react"
import { OnboardingTargets } from "@/components/post-session/onboarding-targets"

interface PostSessionShellProps {
	pacingMinutes?: number
}

function PostSessionShell(props: PostSessionShellProps) {
	let pacingLine: React.ReactNode = null
	if (props.pacingMinutes !== undefined) {
		pacingLine = (
			<p className="text-muted-foreground text-sm">
				Your diagnostic took {props.pacingMinutes} minutes. The real CCAT is 15 minutes for 50 questions.
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
			{pacingLine}
		</main>
	)
}

export { PostSessionShell }
