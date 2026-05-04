"use client"

// <QuestionTimerBarPrimary> — first of two stacked per-question timer
// bars. Renamed (via `git mv`) from <QuestionTimerBar> in commit 3 of
// the focus-shell post-overhaul-fixes round; the second bar is
// <QuestionTimerBarOverflow>, and they're composed by
// <QuestionTimerBarStack>.
//
// Behavior (SPEC §6.6, post-overhaul-fixes):
//   - Fill ratio: min(elapsedQuestionMs / perQuestionTargetMs, 1.0).
//     Reaches 100% at the per-question target, capped past target via
//     animation-fill-mode: forwards.
//   - Color: BLUE for elapsed in [0, target/2). RED for elapsed in
//     [target/2, target]. Discrete flip at half-target — the entire
//     visible fill turns red the instant the boundary is crossed; not
//     a gradient.
//
// Implementation: two stacked fill layers in one gray track. Both
// layers grow with the same `fill-bar` keyframe (scaleX 0→1 over the
// full target duration), so they reach the same width at the same
// time. Each layer additionally runs an opacity-flip animation —
// blue is fully opaque during phase 1 then snaps to opacity 0 at
// half-target; red is fully transparent during phase 1 then snaps to
// opacity 1 at half-target. The 49.99% / 50% pair in the keyframes
// (declared in globals.css) is what makes the flip discrete; widening
// that gap softens the transition into a gradient.
//
// `key={props.itemId}` on each fill restarts both animations on item
// advance. The cleanup is uniform — both layers remount together.

import { cn } from "@/lib/utils"
import { DURATION_CLASS_BY_MS } from "@/components/focus-shell/timer-bar"

interface QuestionTimerBarPrimaryProps {
	itemId: string
	perQuestionTargetMs: number
}

function QuestionTimerBarPrimary(props: QuestionTimerBarPrimaryProps) {
	const durationClass = DURATION_CLASS_BY_MS.get(props.perQuestionTargetMs)
	// Same fallback shape as <SessionTimerBar>: peripheral chrome,
	// failing closed (no bar) is worse than slightly-wrong. The
	// DURATION_CLASS_BY_MS map covers the 18000ms canonical target;
	// speed-ramp / brutal modes will need to add their targets to
	// the map when they ship.
	let effectiveDuration: string
	if (durationClass === undefined) {
		effectiveDuration = "[animation-duration:60000ms]"
	} else {
		effectiveDuration = durationClass
	}
	return (
		<div
			className="relative h-1 w-full overflow-hidden rounded-sm bg-gray-200"
			data-testid="question-timer-primary-track"
		>
			{/*
			 * Blue layer — visible during phase 1 (elapsed < target/2),
			 * hidden during phase 2. Both animations (fill-bar transform +
			 * opacity-visible-then-hidden) share the same animation-duration.
			 */}
			<div
				key={props.itemId}
				data-testid="question-timer-primary-fill-blue"
				className={cn(
					"absolute inset-0 origin-left animate-fill-bar-with-opacity-vth bg-blue-600",
					effectiveDuration
				)}
				aria-hidden="true"
			/>
			{/*
			 * Red layer — invisible during phase 1, visible during phase 2.
			 * Stacked on top of the blue layer (same DOM order = same z); the
			 * opacity-flip is what controls which one the user sees.
			 */}
			<div
				key={props.itemId}
				data-testid="question-timer-primary-fill-red"
				className={cn(
					"absolute inset-0 origin-left animate-fill-bar-with-opacity-htv bg-red-600",
					effectiveDuration
				)}
				aria-hidden="true"
			/>
		</div>
	)
}

export type { QuestionTimerBarPrimaryProps }
export { QuestionTimerBarPrimary }
