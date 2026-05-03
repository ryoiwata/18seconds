import { expect, test } from "bun:test"
import { computeMastery, median, sourceParams } from "@/server/mastery/compute"

test("sourceParams: diagnostic enforces 3-attempt threshold and 1.5x latency", function checkDiagnostic() {
	const p = sourceParams("diagnostic")
	expect(p.minAttempts).toBe(3)
	expect(p.latencyMultiplier).toBe(1.5)
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

test("computeMastery: diagnostic with 1.5x latency relaxation passes a slower user", function diagnosticLatencyRelaxation() {
	// Threshold 18s × 1.5 = 27s. User median latency 25s passes the relaxation.
	// 8/10 accuracy + median 25s ≤ 27s → would be `mastered` if allowMastered;
	// but diagnostic caps at fluent.
	const result = computeMastery({
		last10Correct: [true, true, true, true, true, true, true, true, false, false],
		last10LatencyMs: [25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000, 25_000],
		latencyThresholdMs: 18_000,
		previousState: undefined,
		source: "diagnostic"
	})
	expect(result).toBe("fluent")
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
