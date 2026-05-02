import type { Difficulty } from "@/config/sub-types"

type DecileDistribution = Readonly<Record<Difficulty, number>>

// Five deciles for a 50-question full-length test. Each entry is the
// proportional mix of easy/medium/hard/brutal items in that decile,
// per the difficulty-progression decision in docs/design_decisions.md.
// Mirrors the Criteria On-Demand "harder later" curve.
const standardCurve: ReadonlyArray<DecileDistribution> = [
	{ easy: 0.7, medium: 0.25, hard: 0.05, brutal: 0.0 }, // decile 1 (q01-q10)
	{ easy: 0.35, medium: 0.45, hard: 0.2, brutal: 0.0 }, // decile 2 (q11-q20)
	{ easy: 0.15, medium: 0.4, hard: 0.35, brutal: 0.1 }, // decile 3 (q21-q30)
	{ easy: 0.05, medium: 0.25, hard: 0.45, brutal: 0.25 }, // decile 4 (q31-q40)
	{ easy: 0.0, medium: 0.15, hard: 0.4, brutal: 0.45 } // decile 5 (q41-q50)
]

const difficultyCurves = {
	full_length: standardCurve,
	simulation: standardCurve
} as const

type CurveKey = keyof typeof difficultyCurves

const DIFFICULTY_ORDER: ReadonlyArray<Difficulty> = ["easy", "medium", "hard", "brutal"]

interface CountedTier {
	tier: Difficulty
	whole: number
	remainder: number
	originalIndex: number
}

// Largest-remainder rounding within a 10-item decile, ties broken by
// lower-tier preference. So 7.0 easy + 2.5 medium + 0.5 hard rounds to
// 7 easy + 3 medium + 0 hard, not 7 + 2 + 1. Documented in the
// difficulty-progression decision.
function roundDecile(distribution: DecileDistribution, totalCount: number): Record<Difficulty, number> {
	const counted: CountedTier[] = DIFFICULTY_ORDER.map(function buildCounted(tier, idx) {
		const exact = distribution[tier] * totalCount
		const whole = Math.floor(exact)
		const remainder = exact - whole
		return { tier, whole, remainder, originalIndex: idx }
	})
	let assigned = counted.reduce(function sumWhole(acc, c) {
		return acc + c.whole
	}, 0)
	const sorted = [...counted].sort(function compareForRoundUp(a, b) {
		if (a.remainder !== b.remainder) {
			return b.remainder - a.remainder
		}
		// tie-break: lower tier wins (lower originalIndex)
		return a.originalIndex - b.originalIndex
	})
	for (const c of sorted) {
		if (assigned >= totalCount) {
			break
		}
		c.whole += 1
		assigned += 1
	}
	const result: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, brutal: 0 }
	for (const c of counted) {
		result[c.tier] = c.whole
	}
	return result
}

export type { CurveKey, DecileDistribution }
export { difficultyCurves, roundDecile, standardCurve }
