"use client"

// <QuestionTimerBar> — per-question SHRINK bar above the question text
// in the central column. Phase 3 polish commit 2 flipped the default
// to visible (commit 2 + content-component prop edits) and repositioned
// the bar from the shell's footer to immediately above the question
// content. Distinct color register from <SessionTimerBar> so the user
// doesn't conflate per-question time with session-progress time.
//
// SPEC §6.6 / PRD §5.1 + plan §5.2.

import { TimerBar } from "@/components/focus-shell/timer-bar"

interface QuestionTimerBarProps {
	itemId: string
	perQuestionTargetMs: number
}

function QuestionTimerBar(props: QuestionTimerBarProps) {
	return (
		<div className="w-full">
			{/* `key={props.itemId}` so the bar restarts on every item swap. */}
			<TimerBar
				key={props.itemId}
				durationMs={props.perQuestionTargetMs}
				mode="shrink"
				className="h-1 bg-primary/40"
			/>
		</div>
	)
}

export type { QuestionTimerBarProps }
export { QuestionTimerBar }
