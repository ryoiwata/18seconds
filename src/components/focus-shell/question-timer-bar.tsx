"use client"

// <QuestionTimerBar> — per-question countdown bar in the shell's
// `footer` area. Hidden by default in Phase 3 (timerPrefs.questionTimerVisible
// is hardcoded false at the server-action default). The toggle UI and
// the persistTimerPrefs write path are Phase 5.
//
// SPEC §6.6 / PRD §5.1.

import { TimerBar } from "@/components/focus-shell/timer-bar"

interface QuestionTimerBarProps {
	itemId: string
	perQuestionTargetMs: number
}

function QuestionTimerBar(props: QuestionTimerBarProps) {
	return (
		<div className="w-full opacity-30">
			{/* `key={props.itemId}` so the bar restarts on every item swap. */}
			<TimerBar key={props.itemId} durationMs={props.perQuestionTargetMs} />
		</div>
	)
}

export type { QuestionTimerBarProps }
export { QuestionTimerBar }
