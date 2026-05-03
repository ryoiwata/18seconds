"use client"

// <FocusShell> — the single load-bearing client primitive of the
// application. SPEC §6 / Plan §5.
//
// Owns:
// - the useReducer state (shell-reducer.ts)
// - the requestAnimationFrame tick loop (dispatches `tick` every frame)
// - the keyboard listeners (T for triage, Enter for submit)
// - the async server-action calls (onSubmitAttempt, onEndSession,
//   onRecordDiagnosticOvertime)
//
// Renders:
// - header: <SessionTimerBar> + <PaceTrack> (hidden for diagnostic)
// - content: <ItemSlot> (latency-anchor host, keyed on currentItem.id)
// - footer: <QuestionTimerBar> (hidden when timerPrefs.questionTimerVisible
//   is false — Phase 3 default)
// - overlays: <TriagePrompt>, <InterQuestionCard>,
//   <DiagnosticOvertimeNote>, <Heartbeat> (sibling to <ItemSlot>)
//
// Phase 3 wires this against the (app)/actions.ts surface in commit 4.
// Commit 2 just builds the component + the smoke page that mounts it
// with stubbed action handlers.

import * as errors from "@superbuilders/errors"
import * as React from "react"
import { DiagnosticOvertimeNote } from "@/components/focus-shell/diagnostic-overtime-note"
import { Heartbeat } from "@/components/focus-shell/heartbeat"
import { InterQuestionCard } from "@/components/focus-shell/inter-question-card"
import { ItemSlot } from "@/components/focus-shell/item-slot"
import { PaceTrack } from "@/components/focus-shell/pace-track"
import { QuestionTimerBar } from "@/components/focus-shell/question-timer-bar"
import { SessionTimerBar } from "@/components/focus-shell/session-timer-bar"
import {
	type TickContext,
	initShellState,
	makeReducer
} from "@/components/focus-shell/shell-reducer"
import { TriagePrompt } from "@/components/focus-shell/triage-prompt"
import type { FocusShellProps, SubmitAttemptInput } from "@/components/focus-shell/types"
import { Button } from "@/components/ui/button"
import { logger } from "@/logger"
import { cn } from "@/lib/utils"

function FocusShell(props: FocusShellProps) {
	const tickCtx: TickContext = React.useMemo(
		function buildCtx() {
			return {
				perQuestionTargetMs: props.perQuestionTargetMs,
				sessionType: props.sessionType
			}
		},
		[props.perQuestionTargetMs, props.sessionType]
	)
	const reducer = React.useMemo(
		function buildReducer() {
			return makeReducer(tickCtx)
		},
		[tickCtx]
	)
	const [state, dispatch] = React.useReducer(reducer, null, function init() {
		return initShellState({
			initialItem: props.initialItem,
			timerPrefs: props.initialTimerPrefs,
			targetQuestionCount: props.targetQuestionCount,
			startMs: performance.now()
		})
	})

	// requestAnimationFrame tick loop — drives elapsed values, triage-
	// prompt firing, and the diagnostic-overtime threshold check.
	React.useEffect(function startTickLoop() {
		let rafId = 0
		function tick() {
			dispatch({ kind: "tick", nowMs: performance.now() })
			rafId = requestAnimationFrame(tick)
		}
		rafId = requestAnimationFrame(tick)
		return function stopTickLoop() {
			cancelAnimationFrame(rafId)
		}
	}, [])

	// Once the diagnostic-overtime flag flips, fire the server action that
	// records the timestamp on the row. Idempotent at the column level
	// (the action's UPDATE has WHERE col IS NULL).
	const onRecordDiagnosticOvertime = props.onRecordDiagnosticOvertime
	React.useEffect(
		function recordOvertime() {
			if (!state.diagnosticOvertimeNoteShown) return
			const fn = onRecordDiagnosticOvertime
			if (fn === undefined) return
			async function run(invoke: () => Promise<void>) {
				const result = await errors.try(invoke())
				if (result.error) {
					logger.warn(
						{ error: result.error },
						"focus-shell: onRecordDiagnosticOvertime threw — non-fatal"
					)
				}
			}
			void run(fn)
		},
		[state.diagnosticOvertimeNoteShown, onRecordDiagnosticOvertime]
	)

	const stateRef = React.useRef(state)
	React.useEffect(
		function syncStateRef() {
			stateRef.current = state
		},
		[state]
	)

	const onSubmitAttempt = props.onSubmitAttempt
	const onEndSession = props.onEndSession
	const sessionId = props.sessionId

	const performSubmit = React.useCallback(
		async function performSubmit(): Promise<void> {
			const snapshot = stateRef.current
			const submitNowMs = performance.now()
			const latencyMs = Math.max(
				0,
				Math.floor(submitNowMs - snapshot.questionStartedAtMs)
			)
			const input: SubmitAttemptInput = {
				sessionId,
				itemId: snapshot.currentItem.id,
				selectedAnswer: snapshot.selectedOptionId,
				latencyMs,
				triagePromptFired: snapshot.triagePromptFired,
				triageTaken: snapshot.triageTaken,
				selection: snapshot.currentItem.selection
			}
			dispatch({ kind: "submit_started" })
			const submitResult = await errors.try(onSubmitAttempt(input))
			if (submitResult.error) {
				logger.error(
					{ error: submitResult.error, sessionId, itemId: input.itemId },
					"focus-shell: onSubmitAttempt threw"
				)
				return
			}
			const result = submitResult.data
			if (result.nextItem === undefined) {
				const endResult = await errors.try(onEndSession())
				if (endResult.error) {
					logger.error(
						{ error: endResult.error, sessionId },
						"focus-shell: onEndSession threw"
					)
				}
				return
			}
			dispatch({ kind: "advance", next: result.nextItem })
		},
		[onSubmitAttempt, onEndSession, sessionId]
	)

	// Drive the async submit when submitPending flips true. We use a
	// flag-on-state-and-effect pattern so triage_take and the Submit
	// button funnel through the same path.
	React.useEffect(
		function runSubmitWhenPending() {
			if (!state.submitPending) return
			async function run() {
				const result = await errors.try(performSubmit())
				if (result.error) {
					logger.error(
						{ error: result.error, sessionId },
						"focus-shell: performSubmit threw"
					)
				}
			}
			void run()
		},
		[state.submitPending, performSubmit, sessionId]
	)

	// Keyboard handler for `T` (triage take) and `Enter` (submit).
	// 1–5 / A–E are handled by <ItemPrompt>'s own keydown listener.
	//
	// Both handlers early-return if a submit is already in flight (read
	// from stateRef so the listener doesn't need to re-attach on every
	// render). The reducer also guards against double-submit, but doing
	// it here too means we don't even queue a redundant action.
	React.useEffect(function attachKeyboard() {
		function onKey(event: KeyboardEvent) {
			const target = event.target
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
				return
			}
			const key = event.key
			const isTriage = key === "T" || key === "t"
			const isEnter = key === "Enter"
			if (!isTriage && !isEnter) return
			event.preventDefault()
			if (stateRef.current.submitPending) return
			if (isTriage) {
				dispatch({ kind: "triage_take", nowMs: performance.now() })
				return
			}
			dispatch({ kind: "submit", nowMs: performance.now() })
		}
		window.addEventListener("keydown", onKey)
		return function detachKeyboard() {
			window.removeEventListener("keydown", onKey)
		}
	}, [])

	const sessionDurationMs = props.sessionDurationMs
	const overtimeUntil = state.diagnosticOvertimeNoteVisibleUntilMs
	const overtimeVisible = overtimeUntil !== undefined && state.elapsedSessionMs <= overtimeUntil

	// Build the peripheral nodes inside narrowed branches so we don't have
	// to re-check `sessionDurationMs !== null` when passing it as a prop.
	let sessionTimerNode: React.ReactNode = null
	let paceTrackNode: React.ReactNode = null
	if (sessionDurationMs !== null && state.timerPrefs.sessionTimerVisible) {
		sessionTimerNode = (
			<SessionTimerBar
				sessionId={props.sessionId}
				durationMs={sessionDurationMs}
				elapsedMs={state.elapsedSessionMs}
			/>
		)
		if (props.paceTrackVisible) {
			paceTrackNode = (
				<PaceTrack
					totalQuestions={props.targetQuestionCount}
					questionsRemaining={state.questionsRemaining}
				/>
			)
		}
	}

	let questionTimerNode: React.ReactNode = null
	if (state.timerPrefs.questionTimerVisible) {
		questionTimerNode = (
			<QuestionTimerBar
				itemId={state.currentItem.id}
				perQuestionTargetMs={props.perQuestionTargetMs}
			/>
		)
	}

	const strictModeAttr = String(props.strictMode)

	return (
		<div
			data-strict-mode={strictModeAttr}
			className={cn(
				"grid min-h-dvh w-full",
				"grid-rows-[auto_1fr_auto]",
				"gap-4 px-6 py-4"
			)}
		>
			{/* header — session timer + pace track. Hidden entirely for
			    diagnostic (sessionDurationMs === null) and toggleable for
			    other types via timerPrefs.sessionTimerVisible. */}
			<div className="flex flex-col gap-1">
				{sessionTimerNode}
				{paceTrackNode}
			</div>

			{/* content — the only fully-illuminated area. */}
			<div className="mx-auto w-full max-w-2xl py-12">
				<ItemSlot
					key={state.currentItem.id}
					item={state.currentItem}
					selectedOptionId={state.selectedOptionId}
					onSelectOption={function selectOption(optionId: string) {
						dispatch({ kind: "select", optionId })
					}}
					onMounted={function onItemMounted(nowMs: number) {
						dispatch({ kind: "set_question_started", nowMs })
					}}
				/>
				<div className="mt-8 flex justify-end">
					<Button
						onClick={function clickSubmit() {
							if (state.submitPending) return
							dispatch({ kind: "submit", nowMs: performance.now() })
						}}
						disabled={state.submitPending}
					>
						Submit
					</Button>
				</div>
			</div>

			{/* footer — per-question timer (hidden by default in Phase 3). */}
			<div>{questionTimerNode}</div>

			{/* overlays — outside the grid layout. */}
			<TriagePrompt
				visible={state.triagePromptFired}
				ifThenPlan={props.ifThenPlan}
				onTake={function takeTriage() {
					dispatch({ kind: "triage_take", nowMs: performance.now() })
				}}
			/>
			<InterQuestionCard visible={state.interQuestionVisible} />
			<DiagnosticOvertimeNote visible={overtimeVisible} />
			<Heartbeat sessionId={props.sessionId} />
		</div>
	)
}

export type { FocusShellProps }
export { FocusShell }
