// masteryRecomputeWorkflow — fired by endSession (and by the
// abandon-sweep cron). Walks the distinct sub-types touched in the
// session and calls recomputeForUser per sub-type. Each recompute is its
// own `'use step'` so a transient failure on one sub-type doesn't lose
// work done for the others (independent retry per the architecture-plan
// generation-pipeline pattern).
//
// SPEC §9.4. Sequential, not parallelized — the few hundred milliseconds
// saved by parallelism aren't worth the partial-failure complexity.
//
// All step bodies live in `./mastery-recompute-steps`. This file
// contains only the workflow orchestration so the `@workflow/next`
// plugin's node-module guard sees no pino-reachable edge in the
// workflow file's import graph. See mastery-recompute-steps.ts for the
// rationale + the actual logic + logger calls.

import {
	listDistinctSubTypesStep,
	loadSessionMetadataStep,
	logRecomputeLoopStartingStep,
	recomputeStep
} from "@/workflows/mastery-recompute-steps"

async function masteryRecomputeWorkflow(input: { sessionId: string }): Promise<void> {
	"use workflow"
	const meta = await loadSessionMetadataStep(input.sessionId)
	const subTypes = await listDistinctSubTypesStep(input.sessionId)
	await logRecomputeLoopStartingStep({
		sessionId: input.sessionId,
		subTypeCount: subTypes.length,
		source: meta.source
	})
	for (const subTypeId of subTypes) {
		await recomputeStep(meta.userId, subTypeId, meta.source)
	}
}

export { masteryRecomputeWorkflow }
