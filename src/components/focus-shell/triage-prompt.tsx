"use client"

// <TriagePrompt> — peripheral overlay rendered when the per-question
// elapsed time crosses the per-question target (18s in Phase 3) and
// the prompt has not yet fired this question. Plan §5.2 + SPEC §6.7.
//
// LOAD-BEARING: this prompt does NOT auto-submit. Its pedagogical
// value is exactly that the user has to make the decision to abandon.
// The session timer is the only hard cutoff.
//
// The user takes the prompt by clicking it OR pressing `T` (the key
// listener lives in the parent FocusShell).

import { cn } from "@/lib/utils"

interface TriagePromptProps {
	visible: boolean
	ifThenPlan?: string
	onTake: () => void
}

function TriagePrompt(props: TriagePromptProps) {
	if (!props.visible) return null
	const hasPlan = props.ifThenPlan !== undefined && props.ifThenPlan.length > 0
	const message = hasPlan ? props.ifThenPlan : "Best move: guess and advance."
	const hotkey = hasPlan ? null : <span className="ml-2 font-mono text-foreground/50 text-xs">(T)</span>
	return (
		<button
			type="button"
			aria-live="polite"
			onClick={props.onTake}
			className={cn(
				"fixed bottom-8 left-1/2 -translate-x-1/2",
				"rounded-full border border-foreground/20 bg-background/80 px-4 py-2 backdrop-blur",
				"text-foreground/80 text-sm shadow-md",
				"transition-opacity",
				"hover:bg-background"
			)}
		>
			<span>{message}</span>
			{hotkey}
		</button>
	)
}

export type { TriagePromptProps }
export { TriagePrompt }
