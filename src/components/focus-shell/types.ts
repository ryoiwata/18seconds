// Shared types for the FocusShell client component and its peripherals.
//
// Some types here are duplicated from src/server/sessions/* and
// src/server/items/selection.ts so the client bundle never imports the
// server modules. The shapes are checked against the server originals
// via the structural-compatibility test in the action-wrapper layer at
// src/app/(app)/actions.ts (commit 1) — if the server type drifts, that
// boundary breaks at compile time and forces a sync here.

import type { ItemBody } from "@/server/items/body-schema"

type SessionType = "diagnostic" | "drill" | "full_length" | "simulation" | "review"

type Difficulty = "easy" | "medium" | "hard" | "brutal"
type FallbackLevel = "fresh" | "session-soft" | "recency-soft" | "tier-degraded"

interface ItemSelection {
	servedAtTier: Difficulty
	fallbackFromTier?: Difficulty
	fallbackLevel: FallbackLevel
}

interface ItemForRender {
	id: string
	body: ItemBody
	options: { id: string; text: string }[]
	selection: ItemSelection
}

interface TimerPrefs {
	sessionTimerVisible: boolean
	questionTimerVisible: boolean
}

interface SubmitAttemptInput {
	sessionId: string
	itemId: string
	selectedAnswer?: string
	latencyMs: number
	triagePromptFired: boolean
	triageTaken: boolean
	selection: ItemSelection
}

interface SubmitAttemptResult {
	nextItem?: ItemForRender
}

interface FocusShellProps {
	sessionId: string
	sessionType: SessionType
	// `null` for non-timed sessions. The diagnostic now passes the
	// 15-minute hard-cutoff value (commit 1's
	// DIAGNOSTIC_SESSION_DURATION_MS) so the session-progress bar and
	// the cosmetic last-question indicator have something to bind to;
	// the actual cutoff is enforced server-side in `submitAttempt`.
	sessionDurationMs: number | null
	perQuestionTargetMs: number
	targetQuestionCount: number
	paceTrackVisible: boolean
	initialTimerPrefs: TimerPrefs
	ifThenPlan?: string
	initialItem: ItemForRender
	// `true` for simulation only (Phase 5). Disables any pause UI etc.
	// Phase 3 callers pass `false`.
	strictMode: boolean
	onSubmitAttempt: (input: SubmitAttemptInput) => Promise<SubmitAttemptResult>
	onEndSession: () => Promise<void>
	// `onRecordDiagnosticOvertime` was deleted in commit 2 — the
	// diagnostic now hard-stops at 15 minutes server-side, replacing
	// the soft "you went over" note that this prop fired.
}

export type {
	Difficulty,
	FallbackLevel,
	FocusShellProps,
	ItemForRender,
	ItemSelection,
	SessionType,
	SubmitAttemptInput,
	SubmitAttemptResult,
	TimerPrefs
}
