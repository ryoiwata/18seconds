import { expect, test } from "bun:test"
import { computeMastery, median, sourceParams } from "@/server/mastery/compute"

test("sourceParams: diagnostic enforces 3-attempt threshold and 1.2x latency", function checkDiagnostic() {
	// 1.2× recalibrated from 1.5× per
	// docs/plans/phase-3-polish-practice-surface-features.md §3.1 (the
	// 15-minute hard-cutoff makes the original "untimed capacity
	// baseline" framing wrong; 1.2× still acknowledges first-exposure
	// novelty without over-crediting fast-but-careless attempts under
	// hard pressure).
	const p = sourceParams("diagnostic")
	expect(p.minAttempts).toBe(3)
	expect(p.latencyMultiplier).toBe(1.2)
	expect(p.allowMastered).toBe(false)
})

test("sourceParams: ongoing enforces 5-attempt threshold and 1.0x latency", function checkOngoing() {
	const p = sourceParams("ongoing")
	expect(p.minAttempts).toBe(5)
	expect(p.latencyMultiplier).toBe(1.0)
	expect(p.allowMastered).toBe(true)
})

test("median: empty input returns 0", function emptyMedian() {
	expect(median([])).toBe(0)
})

test("median: odd-length array returns middle element", function oddMedian() {
	expect(median([1, 5, 3])).toBe(3)
	expect(median([10])).toBe(10)
})

test("median: even-length array returns average of two middle elements", function evenMedian() {
	expect(median([1, 2, 3, 4])).toBe(2.5)
	expect(median([10, 20])).toBe(15)
})

test("computeMastery: under min attempts → learning (diagnostic)", function underThresholdDiagnostic() {
	const result = computeMastery({
		last10Correct: [true, true],
		last10LatencyMs: [10_000, 10_000],
		latencyThresholdMs: 18_000,
		previousState: undefined,
		source: "diagnostic"
	})
	expect(result).toBe("learning")
})

test("computeMastery: under min attempts → learning (ongoing)", function underThresholdOngoing() {
	const result = computeMastery({
		last10Correct: [true, true, true, true],
		last10LatencyMs: [10_000, 10_000, 10_000, 10_000],
		latencyThresholdMs: 18_000,
		previousState: undefined,
		source: "ongoing"
	})
	expect(result).toBe("learning")
})

test("computeMastery: diagnostic NEVER assigns mastered even on perfect performance", function diagnosticCannotMaster() {
	const result = computeMastery({
		last10Correct: [true, true, true, true, true, true, true, true, true, true],
		last10LatencyMs: [5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000],
		latencyThresholdMs: 18_000,
		previousState: undefined,
		source: "diagnostic"
	})
	expect(result).toBe("fluent")
})

test("computeMastery: ongoing source returns mastered on perfect performance", function ongoingCanMaster() {
	const result = computeMastery({
		last10Correct: [true, true, true, true, true, true, true, true, true, true],
		last10LatencyMs: [5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000],
		latencyThresholdMs: 18_000,
		previousState: undefined,
		source: "ongoing"
	})
	expect(result).toBe("mastered")
})

test("computeMastery: ongoing source returns fluent when fast but inaccurate", function ongoingFluent() {
	const result = computeMastery({
		last10Correct: [true, true, true, true, true, true, true, true, false, false],
		last10LatencyMs: [25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000],
		latencyThresholdMs: 18_000,
		previousState: undefined,
		source: "ongoing"
	})
	// 8/10 = 0.8 accuracy, median 25s > 18s threshold → fluent
	expect(result).toBe("fluent")
})

test("computeMastery: ongoing source returns decayed when previously mastered and slipping", function ongoingDecayed() {
	const result = computeMastery({
		last10Correct: [true, true, true, true, true, false, false, false, false, false],
		last10LatencyMs: [25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000],
		latencyThresholdMs: 18_000,
		previousState: "mastered",
		source: "ongoing"
	})
	// 5/10 = 0.5 accuracy, was previously mastered → decayed
	expect(result).toBe("decayed")
})

test("computeMastery: diagnostic high-accuracy slow user lands fluent under 1.2x (was already fluent under 1.5x — verdict invariant for diagnostic)", function diagnosticHighAccuracySlow() {
	// DEVIATION FROM PLAN §4.3 — documented in commit 1's report.
	//
	// Plan §4.3 asserted an "over-credit case (a)": same input that
	// lands `fluent` under 1.5× would fall to `learning` under 1.2×.
	// That premise was wrong. Tracing the current `computeMastery`
	// branch logic for diagnostic source:
	//
	//   - For accuracy ≥ 0.8: result is `fluent` regardless of
	//     `medianLatency vs adjustedThreshold`. The `mastered` branch
	//     is masked by `allowMastered: false`, and BOTH the
	//     "high-acc + slow" branch and the "high-acc + fast" branch
	//     return `fluent` (the latter via the explicit diagnostic-cap
	//     branch at the bottom of computeMastery).
	//   - For accuracy < 0.8: result is `learning` regardless of
	//     latency multiplier (the multiplier doesn't gate anything for
	//     this branch).
	//
	// So the multiplier has NO effect on diagnostic verdicts under the
	// current branch logic. The 1.5 → 1.2 change is a documented
	// recalibration that would matter if the branch logic ever
	// distinguishes between the two paths (e.g., a future "high-acc +
	// slow but within-relaxation" branch that rewards `fluent` more
	// strongly than "high-acc + slow + outside-relaxation").
	//
	// This test pins the current behavior: high-accuracy + slow yields
	// `fluent` under the 1.2× multiplier. If a future change makes the
	// multiplier load-bearing for diagnostic, this test surfaces the
	// new behavior at the same input.
	const result = computeMastery({
		last10Correct: [true, true, true, true, true, true, true, true, false, false],
		last10LatencyMs: [25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000],
		latencyThresholdMs: 18_000,
		previousState: undefined,
		source: "diagnostic"
	})
	expect(result).toBe("fluent")
})

test("computeMastery: diagnostic floor case — slow + inaccurate stays learning under any multiplier", function diagnosticFloorCase() {
	// Plan §4.3 floor case: low accuracy AND slow latency lands
	// `learning` regardless of latency multiplier. 4/10 accuracy fails
	// the accuracy gate; the multiplier is irrelevant. This test pins
	// the floor — even if the multiplier moves, this case must stay
	// `learning`.
	const result = computeMastery({
		last10Correct: [true, true, true, true, false, false, false, false, false, false],
		last10LatencyMs: [30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000, 30_000],
		latencyThresholdMs: 18_000,
		previousState: undefined,
		source: "diagnostic"
	})
	expect(result).toBe("learning")
})

test("computeMastery: low accuracy → learning regardless of source", function lowAccuracyLearning() {
	const result = computeMastery({
		last10Correct: [true, false, false, false, false, false, false, false, false, false],
		last10LatencyMs: [10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000],
		latencyThresholdMs: 18_000,
		previousState: undefined,
		source: "ongoing"
	})
	expect(result).toBe("learning")
})

test("computeMastery: 3 attempts (just over diagnostic threshold) yields a real result", function diagnosticBoundary() {
	const result = computeMastery({
		last10Correct: [true, true, true],
		last10LatencyMs: [5000, 5000, 5000],
		latencyThresholdMs: 18_000,
		previousState: undefined,
		source: "diagnostic"
	})
	// 3/3 = 1.0 accuracy, fast → fluent (capped, not mastered)
	expect(result).toBe("fluent")
})

test("computeMastery: previously mastered with on-pace performance stays mastered", function previouslyMasteredHolds() {
	const result = computeMastery({
		last10Correct: [true, true, true, true, true, true, true, true, false, false],
		last10LatencyMs: [10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000],
		latencyThresholdMs: 18_000,
		previousState: "mastered",
		source: "ongoing"
	})
	// 0.8 accuracy + 10s ≤ 18s → mastered
	expect(result).toBe("mastered")
})
