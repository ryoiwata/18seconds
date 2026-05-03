// SPEC §9.6 — derive the single-line "today's near goal" string for the
// Mastery Map. Pure function; no DB access. The Mastery Map page reads
// `mastery_state`, `users.target_date_ms`, and `Date.now()` and passes
// them in.
//
// Phase 3 wires the read; Phase 5 may iterate on the wording.

import type { SubTypeId } from "@/config/sub-types"
import type { MasteryLevel } from "@/server/mastery/compute"

const MS_PER_DAY = 86_400_000

interface DeriveNearGoalInput {
	masteryStates: ReadonlyMap<SubTypeId, MasteryLevel>
	targetDateMs: number | undefined
	nowMs: number
}

function deriveNearGoal(input: DeriveNearGoalInput): string {
	if (input.targetDateMs === undefined) {
		return "Set a target date to see today's goal."
	}
	let remainingSubTypes = 0
	for (const [, state] of input.masteryStates) {
		if (state !== "mastered") remainingSubTypes += 1
	}
	const daysRemaining = Math.max(1, Math.ceil((input.targetDateMs - input.nowMs) / MS_PER_DAY))
	const sessionsPerDay = Math.ceil((remainingSubTypes * 2) / daysRemaining)
	const plural = sessionsPerDay === 1 ? "" : "s"
	return `${sessionsPerDay} session${plural} today to stay on track.`
}

export type { DeriveNearGoalInput }
export { deriveNearGoal }
