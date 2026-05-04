"use client"

// <QuestionTimerBarStack> — wrapper around the two per-question timer
// bars (post-overhaul-fixes commit 3). Owns the layout rhythm and the
// shared "Per question time" label; each bar component owns its own
// fill animation.
//
// Visual stack from top:
//   <QuestionTimerBarPrimary>     — covers [0, target). Phase-keyed
//                                   blue-then-red discrete flip at
//                                   half-target.
//   <QuestionTimerBarOverflow>    — covers [target, 2×target). All red.
//   "Per question time" label
//
// Replaces the single <QuestionTimerBar> from the focus-shell overhaul
// commit 5. Same prop signature so <FocusShell> consumes it
// drop-in.

import { QuestionTimerBarOverflow } from "@/components/focus-shell/question-timer-bar-overflow"
import { QuestionTimerBarPrimary } from "@/components/focus-shell/question-timer-bar-primary"

interface QuestionTimerBarStackProps {
	itemId: string
	perQuestionTargetMs: number
}

function QuestionTimerBarStack(props: QuestionTimerBarStackProps) {
	return (
		<div
			className="flex w-full flex-col gap-1"
			data-testid="question-timer-stack"
		>
			<QuestionTimerBarPrimary
				itemId={props.itemId}
				perQuestionTargetMs={props.perQuestionTargetMs}
			/>
			<QuestionTimerBarOverflow
				itemId={props.itemId}
				perQuestionTargetMs={props.perQuestionTargetMs}
			/>
			<span
				className="text-foreground/60 text-xs"
				data-testid="question-timer-label"
			>
				Per question time
			</span>
		</div>
	)
}

export type { QuestionTimerBarStackProps }
export { QuestionTimerBarStack }
