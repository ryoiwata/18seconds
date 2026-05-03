// <MasteryIcon> — single-icon primitive used by the Mastery Map's two
// row groups. Plan §6.3 / PRD §5.2.
//
// Icon fill semantics (mapped from mastery_state.current_state):
//   - undefined      → outlined, locked-style (not yet attempted)
//   - 'learning'     → outlined
//   - 'fluent'       → half-filled
//   - 'mastered'     → filled
//   - 'decayed'      → outlined (treat as fallen-back-to-learning visually)
//
// No percentages, no numbers, no scores beneath. Per PRD §5.2 the icon
// IS the signal — text would re-introduce a score-chasing dynamic.

import { BookOpen, Calculator } from "lucide-react"
import type * as React from "react"
import type { SubTypeId } from "@/config/sub-types"
import type { MasteryLevel } from "@/server/mastery/compute"
import { cn } from "@/lib/utils"

interface MasteryIconProps {
	subTypeId: SubTypeId
	displayName: string
	section: "verbal" | "numerical"
	state: MasteryLevel | undefined
}

interface VisualState {
	stroke: string
	fill: string
	opacity: string
}

function visualStateFor(state: MasteryLevel | undefined): VisualState {
	if (state === "mastered") {
		return { stroke: "stroke-foreground", fill: "fill-foreground", opacity: "opacity-100" }
	}
	if (state === "fluent") {
		return { stroke: "stroke-foreground", fill: "fill-foreground/50", opacity: "opacity-100" }
	}
	if (state === "decayed") {
		return { stroke: "stroke-foreground", fill: "fill-transparent", opacity: "opacity-90" }
	}
	if (state === "learning") {
		return { stroke: "stroke-foreground", fill: "fill-transparent", opacity: "opacity-100" }
	}
	// undefined — never attempted.
	return { stroke: "stroke-foreground/40", fill: "fill-transparent", opacity: "opacity-50" }
}

function MasteryIcon(props: MasteryIconProps) {
	const visual = visualStateFor(props.state)
	let Icon: React.ComponentType<{ className?: string }> = BookOpen
	if (props.section === "numerical") Icon = Calculator
	const stateLabel = props.state === undefined ? "not yet attempted" : props.state
	return (
		<div
			role="img"
			className={cn(
				"flex flex-col items-center gap-2",
				visual.opacity
			)}
			data-sub-type-id={props.subTypeId}
			data-state={stateLabel}
			aria-label={`${props.displayName}: ${stateLabel}`}
		>
			<div className="flex h-12 w-12 items-center justify-center rounded-full border border-foreground/10 bg-background">
				<Icon className={cn("h-6 w-6", visual.stroke, visual.fill)} />
			</div>
			<span className="text-center text-foreground/70 text-xs leading-tight">
				{props.displayName}
			</span>
		</div>
	)
}

export type { MasteryIconProps }
export { MasteryIcon, visualStateFor }
