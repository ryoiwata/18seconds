"use client"

// <PaceTrack> — discrete blocks below the session timer. One block per
// question; the leftmost block is removed on each submit. Tied to the
// session-timer visibility (toggling the session timer toggles both).
// SPEC §5.1 (PRD) / §6.6 (focus-shell spec).

import { cn } from "@/lib/utils"

interface PaceTrackProps {
	totalQuestions: number
	questionsRemaining: number
}

function PaceTrack(props: PaceTrackProps) {
	const blocks: number[] = []
	for (let i = 0; i < props.totalQuestions; i += 1) {
		blocks.push(i)
	}
	return (
		<div className="flex w-full gap-0.5 opacity-30" aria-hidden="true">
			{blocks.map(function renderBlock(idx) {
				// "Leftmost block is removed on each submit": render only
				// the rightmost N blocks, where N = questionsRemaining.
				const stillVisible = idx >= props.totalQuestions - props.questionsRemaining
				const fillClass = stillVisible ? "bg-foreground/30" : "bg-transparent"
				return <div key={idx} className={cn("h-1 flex-1", fillClass)} />
			})}
		</div>
	)
}

export type { PaceTrackProps }
export { PaceTrack }
