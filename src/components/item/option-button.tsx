"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface OptionButtonProps {
	id: string
	text: string
	selected: boolean
	onSelect: () => void
}

function OptionButtonImpl(props: OptionButtonProps) {
	const { id, text, selected, onSelect } = props
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className={cn(
				"flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors",
				"border-border bg-background text-foreground hover:bg-muted",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				selected && "border-primary bg-primary/10 text-foreground"
			)}
		>
			<span className="font-mono font-semibold text-muted-foreground tabular-nums">{id}.</span>
			<span className="flex-1">{text}</span>
		</button>
	)
}

const OptionButton = React.memo(OptionButtonImpl)

export type { OptionButtonProps }
export { OptionButton }
