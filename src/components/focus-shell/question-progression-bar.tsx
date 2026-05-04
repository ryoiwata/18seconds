"use client"

// <QuestionProgressionBar> — full-width segmented bar where N =
// `totalQuestions`. The leftmost (currentQuestionIndex + 1) segments
// are filled; the rest are unfilled light gray. One continuous bar,
// equal-width segments, thin gap between segments.
//
// Renamed from <PaceTrack> in commit 3 of the focus-shell UI overhaul.
// The "pace track" framing — discrete blocks per question that
// disappear as the user submits, modeling how much budget is left —
// was replaced by a forward-looking "you are on question K of N"
// visualization that mirrors the target screenshots more directly.
//
// `currentQuestionIndex = totalQuestions - questionsRemaining`. On
// question 1 of 5, currentQuestionIndex = 0 and segment 0 alone is
// filled. On question 3, segments 0–2 are filled. On question 5, all
// 5 are filled.
//
// Pace-deficit color (post-overhaul-fixes commit 4, SPEC §6.6):
// fill color is BLUE when on/ahead of pace, RED when behind pace.
// "Behind pace" is computed in <FocusShell> and passed as the
// `behindPace` prop; this component is a pure presenter and does no
// pacing math. The color flip is all-segments-at-once — the K filled
// segments share whichever color the prop selects.

import { cn } from "@/lib/utils"

interface QuestionProgressionBarProps {
	totalQuestions: number
	questionsRemaining: number
	behindPace: boolean
}

function QuestionProgressionBar(props: QuestionProgressionBarProps) {
	const { totalQuestions, questionsRemaining, behindPace } = props
	const currentQuestionIndex = totalQuestions - questionsRemaining
	const segments: number[] = []
	for (let i = 0; i < totalQuestions; i += 1) {
		segments.push(i)
	}
	let filledFillClass: string
	if (behindPace) {
		filledFillClass = "bg-red-600"
	} else {
		filledFillClass = "bg-blue-600"
	}
	return (
		<div
			className="flex w-full gap-0.5"
			aria-hidden="true"
			data-testid="question-progression-bar"
			data-behind-pace={behindPace ? "true" : "false"}
		>
			{segments.map(function renderSegment(idx) {
				const filled = idx <= currentQuestionIndex
				let fillClass: string
				if (filled) {
					fillClass = filledFillClass
				} else {
					fillClass = "bg-gray-200"
				}
				return (
					<div
						key={idx}
						data-testid="question-progression-segment"
						data-filled={filled ? "true" : "false"}
						className={cn("h-1 flex-1 rounded-sm", fillClass)}
					/>
				)
			})}
		</div>
	)
}

export type { QuestionProgressionBarProps }
export { QuestionProgressionBar }
