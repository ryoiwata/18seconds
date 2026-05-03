"use client"

// <QuestionBlockDepletion> — 18 discrete blocks above the question text
// that disappear one-per-second across the per-question 18-second
// window. Visual reinforcement of the 18s target.
//
// docs/plans/phase-3-polish-practice-surface-features.md §5.3.
//
// Pure visual — no behavior change. The triage prompt still fires at
// 18s via the reducer; the session timer is the only hard cutoff. This
// component is `aria-hidden` because the per-question timer bar already
// covers screen-reader semantics; the blocks are pure visual cue.
//
// Pure derivation from `elapsedQuestionMs` (passed down from
// <FocusShell>'s reducer state). No new reducer state, no internal
// timer — the rAF loop in <FocusShell> drives elapsedQuestionMs and
// this component re-renders on each tick, computing
// `blocksRemaining = max(0, 18 - floor(elapsedQuestionMs / 1000))`.

import { cn } from "@/lib/utils"

const TOTAL_BLOCKS = 18
const BLOCK_INDICES: ReadonlyArray<number> = Array.from({ length: TOTAL_BLOCKS }, function makeIdx(_, i) {
	return i
})

interface QuestionBlockDepletionProps {
	elapsedQuestionMs: number
}

function QuestionBlockDepletion(props: QuestionBlockDepletionProps) {
	const elapsedSeconds = Math.floor(props.elapsedQuestionMs / 1000)
	const blocksRemaining = Math.max(0, TOTAL_BLOCKS - elapsedSeconds)
	return (
		<div
			className="flex gap-1"
			aria-hidden="true"
			data-testid="question-block-depletion"
		>
			{BLOCK_INDICES.map(function renderBlock(idx) {
				// Render rightmost N blocks visible (matches the pace track's
				// "leftmost block removed on each step" convention). 12×12px
				// squares per plan §5.3.
				const visible = idx >= TOTAL_BLOCKS - blocksRemaining
				const fillClass = visible ? "bg-foreground/40" : "bg-transparent border border-foreground/10"
				return <div key={idx} className={cn("h-3 w-3 rounded-sm transition-colors", fillClass)} />
			})}
		</div>
	)
}

export type { QuestionBlockDepletionProps }
export { QuestionBlockDepletion, TOTAL_BLOCKS }
