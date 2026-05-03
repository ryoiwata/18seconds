"use client"

// Shared depleting-bar primitive used by <SessionTimerBar> and
// <QuestionTimerBar>. Pure CSS animation — Tailwind arbitrary-property
// classes drive `animation-duration`, `animation` references the
// keyframe-based `--animate-shrink-bar` declared in
// src/styles/unstyled/globals.css.
//
// The duration must come from a small enumerated set so Tailwind's JIT
// can extract the literal `[animation-duration:NNNNNms]` classes at
// build time. If a caller passes an unsupported duration, the bar
// falls back to a 60s class (visible-but-non-load-bearing).

import { cn } from "@/lib/utils"

const DURATION_CLASS_BY_MS: ReadonlyMap<number, string> = new Map<number, string>([
	[18_000, "[animation-duration:18000ms]"],
	[90_000, "[animation-duration:90000ms]"],
	[180_000, "[animation-duration:180000ms]"],
	[360_000, "[animation-duration:360000ms]"],
	[900_000, "[animation-duration:900000ms]"]
])

interface TimerBarProps {
	durationMs: number
	// React `key` should be set on the parent so a new mount restarts the
	// animation when the duration anchor changes (per-item for the
	// question timer, per-session for the session timer).
	className?: string
}

function TimerBar(props: TimerBarProps) {
	const durationClass = DURATION_CLASS_BY_MS.get(props.durationMs)
	if (durationClass === undefined) {
		// Fallback path: 60s default + a warning. We don't throw because
		// the bar is peripheral chrome; failing closed (no bar) is worse
		// for the user than a slightly-wrong bar.
		return (
			<div
				className={cn(
					"h-1 w-full origin-right animate-shrink-bar bg-foreground/30 [animation-duration:60000ms]",
					props.className
				)}
				aria-hidden="true"
			/>
		)
	}
	return (
		<div
			className={cn(
				"h-1 w-full origin-right animate-shrink-bar bg-foreground/30",
				durationClass,
				props.className
			)}
			aria-hidden="true"
		/>
	)
}

export type { TimerBarProps }
export { TimerBar, DURATION_CLASS_BY_MS }
