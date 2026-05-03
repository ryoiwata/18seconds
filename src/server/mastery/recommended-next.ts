// recommendedNextSubType — pure function used by the Mastery Map's
// primary CTA. Plan §6.3.
//
// Picks the lowest-mastery sub-type. Ranking (lowest mastery first):
//   undefined < 'learning' < 'decayed' < 'fluent' < 'mastered'
//
// Deterministic tie-break: lexicographic on sub_type_id. Used so that
// two MasteryMap renders for the same input produce the same CTA.
//
// Returns the sub_type_id chosen. The caller is responsible for
// resolving displayName for the CTA label.

import * as errors from "@superbuilders/errors"
import { type SubTypeId, subTypeIds } from "@/config/sub-types"
import { logger } from "@/logger"
import type { MasteryLevel } from "@/server/mastery/compute"

const RANK: Record<"unknown" | MasteryLevel, number> = {
	unknown: 0,
	learning: 1,
	decayed: 2,
	fluent: 3,
	mastered: 4
}

function rankFor(state: MasteryLevel | undefined): number {
	if (state === undefined) return RANK.unknown
	return RANK[state]
}

function recommendedNextSubType(states: ReadonlyMap<SubTypeId, MasteryLevel>): SubTypeId {
	// Iterate in the canonical order from sub-types.ts (already sorted by
	// definition). Pick the lowest-rank sub-type; tie-break alphabetic.
	const sortedIds: ReadonlyArray<SubTypeId> = [...subTypeIds].sort(function alphabetic(a, b) {
		if (a < b) return -1
		if (a > b) return 1
		return 0
	})
	let bestId: SubTypeId | undefined
	let bestRank = Number.POSITIVE_INFINITY
	for (const id of sortedIds) {
		const r = rankFor(states.get(id))
		if (r < bestRank) {
			bestRank = r
			bestId = id
		}
	}
	if (bestId === undefined) {
		// Unreachable — sortedIds is non-empty (subTypeIds is a non-empty
		// `as const` literal). Defensive throw rather than a non-null
		// assertion per `rules/no-nullish-coalescing.md` §7.
		logger.error({}, "recommendedNextSubType: no sub_type_ids configured")
		throw errors.new("recommendedNextSubType: no sub_type_ids configured")
	}
	return bestId
}

export { rankFor, recommendedNextSubType }
