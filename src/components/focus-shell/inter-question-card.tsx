"use client"

// <InterQuestionCard> — brief overlay between submit and the next item's
// paint. PRD §5.1 / SPEC §6.9.
//
// No progress count. No item index. Just a soft visual transition. The
// reducer auto-clears the visibility after a short window if the next
// item never advances (defensive, prevents a sticky card on a slow
// network).

interface InterQuestionCardProps {
	visible: boolean
}

function InterQuestionCard(props: InterQuestionCardProps) {
	if (!props.visible) return null
	return (
		<div
			aria-hidden="true"
			className="fixed inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm"
		/>
	)
}

export type { InterQuestionCardProps }
export { InterQuestionCard }
