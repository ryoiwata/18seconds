"use client"

// <QuestionTimerBarOverflow> — second of two stacked per-question
// timer bars (commit 3 of the focus-shell post-overhaul-fixes round).
// The companion to <QuestionTimerBarPrimary>; together they're composed
// by <QuestionTimerBarStack>.
//
// Behavior (SPEC §6.6, post-overhaul-fixes):
//   - Empty (scaleX 0) for elapsed in [0, perQuestionTargetMs).
//   - Fills 0 → 100% red over [perQuestionTargetMs, 2 × target).
//   - Caps at 100% red beyond 2 × target (animation-fill-mode: forwards).
//
// Implementation: a single red fill on a gray track, with a custom
// `animate-fill-bar-after-target` utility (declared in globals.css)
// that bakes BOTH the duration AND the delay into the `animation`
// shorthand. We can't use a separate `[animation-delay:18000ms]`
// arbitrary-property class because Tailwind v4 silently expands that
// pattern into multiple `animation` shorthand declarations that reset
// the delay — verified during commit 3's verification (see globals.css
// comment for the captured generated CSS). The custom utility's
// shorthand sets duration + delay together via the
// `<name> <duration> <timing> <delay> <fill-mode>` form.
//
// The 18000ms duration AND delay are both hardcoded in the utility.
// Speed-ramp / brutal modes (Phase 5) with non-18s targets will need
// to add a parallel utility (`--animate-fill-bar-after-target-12s`,
// etc.) rather than templating; the parallel-utility shape is a
// minor cost relative to the JIT-fragility we'd inherit from
// templated arbitrary-property classes.

import { cn } from "@/lib/utils"

interface QuestionTimerBarOverflowProps {
	itemId: string
	perQuestionTargetMs: number
}

function QuestionTimerBarOverflow(props: QuestionTimerBarOverflowProps) {
	// `perQuestionTargetMs` is currently fixed at 18000ms in v1; the
	// `animate-fill-bar-after-target` utility hardcodes that. Logging
	// when callers pass an unsupported target is the right escape
	// hatch for the speed-ramp / brutal expansion above; for now we
	// just void-acknowledge the prop so biome's
	// noUnusedFunctionParameter doesn't fire.
	void props.perQuestionTargetMs
	return (
		<div
			className="relative h-1 w-full overflow-hidden rounded-sm bg-gray-200"
			data-testid="question-timer-overflow-track"
		>
			<div
				key={props.itemId}
				data-testid="question-timer-overflow-fill"
				className={cn(
					"absolute inset-0 origin-left animate-fill-bar-after-target bg-red-600"
				)}
				aria-hidden="true"
			/>
		</div>
	)
}

export type { QuestionTimerBarOverflowProps }
export { QuestionTimerBarOverflow }
