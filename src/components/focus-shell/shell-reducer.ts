// FocusShell reducer per SPEC §6.2 + plan §5.2/5.3.
//
// The reducer is sync. All async work (the server-action calls in
// onSubmitAttempt / onEndSession) lives in the FocusShell component;
// the reducer only models the shell's local state.
//
// Time semantics:
// - questionStartedAtMs and sessionStartedAtMs are captured in
//   performance.now() coordinates. The component captures them at first
//   paint of each item (questionStartedAtMs) and once at mount
//   (sessionStartedAtMs).
// - elapsedQuestionMs / elapsedSessionMs are derived in the reducer's
//   `tick` handler from the action's `nowMs` minus the start values.
//   They never drift from the start values regardless of how many
//   ticks were dropped (e.g., when a tab is backgrounded).
//
// Phase 3 polish commit 2 removed the diagnostic overtime-note
// machinery (the `diagnostic_overtime_note_shown` action,
// `diagnosticOvertimeNoteShown` / `diagnosticOvertimeNoteVisibleUntilMs`
// state fields, and the DIAGNOSTIC_OVERTIME_* constants). The diagnostic
// now hard-stops at 15 minutes server-side in `submitAttempt`; the
// soft "you went over" overlay is obsolete. The cosmetic last-question
// indicator that surfaces when elapsedSessionMs crosses the diagnostic
// duration is derived inline in the FocusShell component — no reducer
// state is needed for it.

import * as errors from "@superbuilders/errors"
import type { ItemForRender, TimerPrefs } from "@/components/focus-shell/types"
import { logger } from "@/logger"

const TRIAGE_TAKEN_WINDOW_MS = 3000
const INTER_QUESTION_FADE_MS = 200

interface ShellState {
	currentItem: ItemForRender
	// performance.now() at first paint of currentItem. Captured by
	// <ItemSlot>'s mount effect, then echoed into state via
	// `set_question_started`. Latency anchor — see plan §9.1 for the
	// risk if this is ever lifted to a non-keyed parent.
	questionStartedAtMs: number
	// performance.now() at session start. Captured once at FocusShell
	// mount and never updated.
	sessionStartedAtMs: number
	elapsedQuestionMs: number
	elapsedSessionMs: number
	timerPrefs: TimerPrefs
	triagePromptFired: boolean
	triagePromptFiredAtMs?: number
	triageTaken: boolean
	selectedOptionId?: string
	interQuestionVisible: boolean
	interQuestionVisibleUntilMs?: number
	questionsRemaining: number
	// One-shot flag set by `submit` and consumed by the FocusShell
	// component to invoke onSubmitAttempt asynchronously. Cleared ONLY
	// by `set_question_started` — i.e., when the next item's <ItemSlot>
	// mounts and dispatches the latency anchor. The mid-await
	// `submit_started` action does NOT clear it; otherwise a fast user
	// pressing Enter twice within the await window would dispatch a
	// second submit against the same (now-stale) item snapshot.
	submitPending: boolean
}

type ShellAction =
	| { kind: "tick"; nowMs: number }
	| { kind: "select"; optionId: string }
	| { kind: "submit"; nowMs: number }
	| { kind: "triage_take"; nowMs: number }
	| { kind: "submit_started" }
	| { kind: "advance"; next: ItemForRender }
	| { kind: "set_question_started"; nowMs: number }
	| { kind: "toggle_session_timer" }
	| { kind: "toggle_question_timer" }

interface InitArgs {
	initialItem: ItemForRender
	timerPrefs: TimerPrefs
	targetQuestionCount: number
	startMs: number
}

function initShellState(args: InitArgs): ShellState {
	return {
		currentItem: args.initialItem,
		questionStartedAtMs: args.startMs,
		sessionStartedAtMs: args.startMs,
		elapsedQuestionMs: 0,
		elapsedSessionMs: 0,
		timerPrefs: args.timerPrefs,
		triagePromptFired: false,
		triagePromptFiredAtMs: undefined,
		triageTaken: false,
		selectedOptionId: undefined,
		interQuestionVisible: false,
		interQuestionVisibleUntilMs: undefined,
		questionsRemaining: args.targetQuestionCount,
		submitPending: false
	}
}

function pickRandomOptionId(item: ItemForRender): string | undefined {
	if (item.options.length === 0) return undefined
	const idx = Math.floor(Math.random() * item.options.length)
	const picked = item.options[idx]
	if (!picked) return undefined
	return picked.id
}

interface TickContext {
	perQuestionTargetMs: number
	sessionType: "diagnostic" | "drill" | "full_length" | "simulation" | "review"
}

function reduceTick(state: ShellState, nowMs: number, ctx: TickContext): ShellState {
	const elapsedQuestionMs = nowMs - state.questionStartedAtMs
	const elapsedSessionMs = nowMs - state.sessionStartedAtMs

	// Triage prompt fires the first time elapsedQuestionMs crosses the
	// per-question target. Persistent — never auto-dismisses (see plan §5.2).
	let triagePromptFired = state.triagePromptFired
	let triagePromptFiredAtMs = state.triagePromptFiredAtMs
	if (!triagePromptFired && elapsedQuestionMs >= ctx.perQuestionTargetMs) {
		triagePromptFired = true
		triagePromptFiredAtMs = elapsedQuestionMs
	}

	// Inter-question card auto-clears when its visibility deadline elapses,
	// so an idle reducer (waiting for advance) doesn't leave the card stuck.
	let interQuestionVisible = state.interQuestionVisible
	if (
		state.interQuestionVisibleUntilMs !== undefined &&
		elapsedSessionMs >= state.interQuestionVisibleUntilMs
	) {
		interQuestionVisible = false
	}

	return {
		...state,
		elapsedQuestionMs,
		elapsedSessionMs,
		triagePromptFired,
		triagePromptFiredAtMs,
		interQuestionVisible
	}
}

function reduceTriageTake(
	state: ShellState,
	action: { kind: "triage_take"; nowMs: number }
): ShellState {
	// Argument's nowMs is unused — the reducer compares elapsed values to
	// `state.triagePromptFiredAtMs`, both of which are derived from the
	// same `tick` action stream. Reserved for future use where the
	// component might want to override the elapsed comparison.
	void action
	// Idempotent against an in-flight submit, same rationale as the
	// `submit` action's guard above.
	if (state.submitPending) return state
	let triageTakenInWindow = state.triageTaken
	if (
		state.triagePromptFired &&
		state.triagePromptFiredAtMs !== undefined &&
		state.elapsedQuestionMs - state.triagePromptFiredAtMs <= TRIAGE_TAKEN_WINDOW_MS
	) {
		triageTakenInWindow = true
	}
	let selectedOptionId = state.selectedOptionId
	if (selectedOptionId === undefined) {
		selectedOptionId = pickRandomOptionId(state.currentItem)
	}
	return {
		...state,
		triageTaken: triageTakenInWindow,
		selectedOptionId,
		submitPending: true
	}
}

function reduceSubmitStarted(state: ShellState): ShellState {
	// Note: submitPending stays true here. The flag only clears when the
	// next item's <ItemSlot> mounts and dispatches set_question_started.
	// This is what closes the race window where a fast Enter press would
	// double-submit during the onSubmitAttempt await.
	return {
		...state,
		interQuestionVisible: true,
		interQuestionVisibleUntilMs: state.elapsedSessionMs + INTER_QUESTION_FADE_MS * 4
	}
}

function reduceAdvance(state: ShellState, next: ItemForRender): ShellState {
	return {
		...state,
		currentItem: next,
		selectedOptionId: undefined,
		triagePromptFired: false,
		triagePromptFiredAtMs: undefined,
		triageTaken: false,
		interQuestionVisible: false,
		interQuestionVisibleUntilMs: undefined,
		questionsRemaining: state.questionsRemaining - 1,
		elapsedQuestionMs: 0
	}
}

function reduceToggleSessionTimer(state: ShellState): ShellState {
	return {
		...state,
		timerPrefs: {
			...state.timerPrefs,
			sessionTimerVisible: !state.timerPrefs.sessionTimerVisible
		}
	}
}

function reduceToggleQuestionTimer(state: ShellState): ShellState {
	return {
		...state,
		timerPrefs: {
			...state.timerPrefs,
			questionTimerVisible: !state.timerPrefs.questionTimerVisible
		}
	}
}

// Dispatch is split into two halves so neither exceeds biome's
// noExcessiveCognitiveComplexity threshold of 15. The `tick` action is
// handled by the outer reducer (it needs ctx), so neither half sees it.
function dispatchPrimary(state: ShellState, action: ShellAction): ShellState | undefined {
	if (action.kind === "select") return { ...state, selectedOptionId: action.optionId }
	if (action.kind === "submit") {
		// Idempotent: if a submit is already in flight, don't bump the
		// reference (also avoids unnecessary re-renders). The dispatch-
		// site guard in <FocusShell> is the primary defense; this is
		// belt-and-suspenders.
		if (state.submitPending) return state
		return { ...state, submitPending: true }
	}
	if (action.kind === "triage_take") return reduceTriageTake(state, action)
	if (action.kind === "submit_started") return reduceSubmitStarted(state)
	if (action.kind === "advance") return reduceAdvance(state, action.next)
	if (action.kind === "set_question_started") {
		return {
			...state,
			questionStartedAtMs: action.nowMs,
			elapsedQuestionMs: 0,
			submitPending: false
		}
	}
	return undefined
}

function dispatchSecondary(state: ShellState, action: ShellAction): ShellState | undefined {
	if (action.kind === "toggle_session_timer") return reduceToggleSessionTimer(state)
	if (action.kind === "toggle_question_timer") return reduceToggleQuestionTimer(state)
	return undefined
}

function makeReducer(ctx: TickContext): (state: ShellState, action: ShellAction) => ShellState {
	return function reducer(state: ShellState, action: ShellAction): ShellState {
		if (action.kind === "tick") return reduceTick(state, action.nowMs, ctx)
		const fromPrimary = dispatchPrimary(state, action)
		if (fromPrimary !== undefined) return fromPrimary
		const fromSecondary = dispatchSecondary(state, action)
		if (fromSecondary !== undefined) return fromSecondary
		// Exhaustiveness: every ShellAction.kind is handled by the two
		// dispatch halves above. If a new kind is added, the compile-time
		// `never` check below catches it inside dispatchPrimary or
		// dispatchSecondary's hidden default branch — but since both
		// helpers return `undefined` for unknown kinds, this final guard
		// is the runtime safety net.
		logger.error({ kind: action.kind }, "shell-reducer: unhandled action kind")
		throw errors.new("shell-reducer: unhandled action kind")
	}
}

export type { InitArgs, ShellAction, ShellState, TickContext }
export {
	INTER_QUESTION_FADE_MS,
	TRIAGE_TAKEN_WINDOW_MS,
	initShellState,
	makeReducer
}
