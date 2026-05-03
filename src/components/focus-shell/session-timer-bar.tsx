"use client"

// <SessionTimerBar> — the session-progress bar in the chrome row of
// the FocusShell. Phase 3 polish commit 2 restyled this to match the
// data/example_ccat_formatting/*.png reference: a thin gray track that
// fills left-to-right as the session elapses (NOT a depleting bar).
//
// The MM:SS chronometer no longer lives inside this component — it's
// rendered separately by <FocusShell> in the top-right slot at
// full-opacity large display weight per the screenshots. This
// component is now just the bar; `formatRemaining` is exported so the
// chronometer can use the same formatting helper without duplicating it.

import { TimerBar } from "@/components/focus-shell/timer-bar"

interface SessionTimerBarProps {
	sessionId: string
	durationMs: number
}

function SessionTimerBar(props: SessionTimerBarProps) {
	return (
		<div className="w-full">
			{/* `key={props.sessionId}` so a remount restarts the animation if
			    the session changes. Within a single session the key is
			    stable; the animation runs to completion uninterrupted. */}
			<TimerBar
				key={props.sessionId}
				durationMs={props.durationMs}
				mode="fill"
				className="h-1 bg-foreground/15"
			/>
		</div>
	)
}

function formatRemaining(durationMs: number, elapsedMs: number): string {
	const remaining = Math.max(0, durationMs - elapsedMs)
	const totalSeconds = Math.floor(remaining / 1000)
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	const minutesStr = String(minutes).padStart(2, "0")
	const secondsStr = String(seconds).padStart(2, "0")
	return `${minutesStr}:${secondsStr}`
}

export type { SessionTimerBarProps }
export { SessionTimerBar, formatRemaining }
