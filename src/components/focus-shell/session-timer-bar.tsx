"use client"

// <SessionTimerBar> — the session-progress bar in the chrome row of
// the FocusShell. Commit 4 of the focus-shell UI overhaul restructured
// this from a single colored div to a two-element track + fill: a
// gray-200 track with a red-600 fill that grows from the left over
// the session duration. Below the bar, an "Overall time" label.
//
// The MM:SS chronometer at the page's top-right is the canonical
// session time display (rendered by <FocusShell>); this bar is the
// visual companion. `formatRemaining` is exported so the chronometer
// can use the same formatting helper without duplicating it.
//
// Implementation: the inner fill is a CSS-keyframe animation
// (`origin-left animate-fill-bar` from globals.css) that scales from
// scaleX(0) to scaleX(1) over `durationMs`. The visual width at any
// frame = (elapsed/duration) × track-width. Verification harnesses
// read the fill via `getBoundingClientRect().width` of the
// `[data-testid='session-timer-fill']` element divided by the track's
// boundingRect width.
//
// `key={props.sessionId}` on the inner fill so a remount restarts the
// animation if the session changes. Within a single session the key
// is stable and the animation runs to completion uninterrupted.

import { cn } from "@/lib/utils"
import { DURATION_CLASS_BY_MS } from "@/components/focus-shell/timer-bar"

interface SessionTimerBarProps {
	sessionId: string
	durationMs: number
}

function SessionTimerBar(props: SessionTimerBarProps) {
	// Match the TimerBar primitive's pattern (early-return on unsupported
	// duration with a 60s fallback animation) — peripheral chrome, so
	// failing closed is worse than slightly-wrong. The
	// DURATION_CLASS_BY_MS map covers every Phase 3 / Phase 5 session
	// length; the fallback exists only for forward-compatibility with
	// future durations not yet enumerated.
	const durationClass = DURATION_CLASS_BY_MS.get(props.durationMs)
	if (durationClass === undefined) {
		return (
			<div className="flex w-full flex-col gap-1" data-testid="session-timer-bar">
				<div
					className="relative h-1 w-full overflow-hidden rounded-sm bg-gray-200"
					data-testid="session-timer-track"
				>
					<div
						key={props.sessionId}
						data-testid="session-timer-fill"
						className="absolute inset-0 origin-left animate-fill-bar bg-red-600 [animation-duration:60000ms]"
						aria-hidden="true"
					/>
				</div>
				<span className="text-foreground/60 text-xs" data-testid="session-timer-label">
					Overall time
				</span>
			</div>
		)
	}
	return (
		<div className="flex w-full flex-col gap-1" data-testid="session-timer-bar">
			<div
				className="relative h-1 w-full overflow-hidden rounded-sm bg-gray-200"
				data-testid="session-timer-track"
			>
				<div
					key={props.sessionId}
					data-testid="session-timer-fill"
					className={cn(
						"absolute inset-0 origin-left animate-fill-bar bg-red-600",
						durationClass
					)}
					aria-hidden="true"
				/>
			</div>
			<span className="text-foreground/60 text-xs" data-testid="session-timer-label">
				Overall time
			</span>
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
