// <NearGoalLine> — single-line "today's near goal" string under the
// Mastery Map heading. Plan §6.3, derived via deriveNearGoal() from
// src/server/mastery/near-goal.ts.

interface NearGoalLineProps {
	text: string
}

function NearGoalLine(props: NearGoalLineProps) {
	return <p className="text-foreground/70 text-sm">{props.text}</p>
}

export type { NearGoalLineProps }
export { NearGoalLine }
