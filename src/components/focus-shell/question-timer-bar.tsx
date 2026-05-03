"use client"

// <QuestionTimerBar> — per-question time bar in the chrome row, sitting
// directly below the question progression bar and above the session
// timer bar. Commit 5 of the focus-shell UI overhaul rebuilt this from
// a single shrinking colored div to a two-element track + fill mirror
// of <SessionTimerBar>: gray-200 track, red-600 fill that grows from
// the left over `perQuestionTargetMs`, capped at 100% via
// animation-fill-mode: forwards (declared in globals.css). Below the
// bar, a "Per question time" label.
//
// `key={props.itemId}` on the inner fill so the animation restarts on
// every item swap. Visibility gating (`timerPrefs.questionTimerVisible`)
// happens upstream in <FocusShell>; if this component renders at all,
// the bar shows.
//
// 100% cap behavior: the CSS keyframe is `from { scaleX(0) } to
// { scaleX(1) }` with `animation-fill-mode: forwards`. After the
// animation duration elapses, the transform stays at scaleX(1) — the
// visual fill width equals the track width and does not overflow.
// The user is allowed to linger past the per-question target without
// submitting (no auto-submit per SPEC §6.7); the bar simply stays at
// 100% red.

import { cn } from "@/lib/utils"
import { DURATION_CLASS_BY_MS } from "@/components/focus-shell/timer-bar"

interface QuestionTimerBarProps {
	itemId: string
	perQuestionTargetMs: number
}

function QuestionTimerBar(props: QuestionTimerBarProps) {
	const durationClass = DURATION_CLASS_BY_MS.get(props.perQuestionTargetMs)
	if (durationClass === undefined) {
		// Same fallback shape as <SessionTimerBar>: peripheral chrome,
		// failing closed is worse than slightly-wrong. The
		// DURATION_CLASS_BY_MS map covers the 18000ms canonical target
		// for Phase 3; speed-ramp / brutal modes will need to add their
		// targets to the map when they ship.
		return (
			<div className="flex w-full flex-col gap-1" data-testid="question-timer-bar">
				<div
					className="relative h-1 w-full overflow-hidden rounded-sm bg-gray-200"
					data-testid="question-timer-track"
				>
					<div
						key={props.itemId}
						data-testid="question-timer-fill"
						className="absolute inset-0 origin-left animate-fill-bar bg-red-600 [animation-duration:60000ms]"
						aria-hidden="true"
					/>
				</div>
				<span className="text-foreground/60 text-xs" data-testid="question-timer-label">
					Per question time
				</span>
			</div>
		)
	}
	return (
		<div className="flex w-full flex-col gap-1" data-testid="question-timer-bar">
			<div
				className="relative h-1 w-full overflow-hidden rounded-sm bg-gray-200"
				data-testid="question-timer-track"
			>
				<div
					key={props.itemId}
					data-testid="question-timer-fill"
					className={cn(
						"absolute inset-0 origin-left animate-fill-bar bg-red-600",
						durationClass
					)}
					aria-hidden="true"
				/>
			</div>
			<span className="text-foreground/60 text-xs" data-testid="question-timer-label">
				Per question time
			</span>
		</div>
	)
}

export type { QuestionTimerBarProps }
export { QuestionTimerBar }
