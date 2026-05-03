"use client"

// <FocusShell> — the single load-bearing client primitive of the
// application. SPEC §6 / Plan §5.
//
// Phase 3 polish commit 2 restyle: layout matches
// data/example_ccat_formatting/*.png. Central column with a
// large MM:SS chronometer top-right, thin session-progress bar (FILL
// mode — grows left-to-right as the session elapses), small "Question
// N / 50" label, thin divider, large question text, optional
// per-question timer + 18-block depletion above the options, tall
// option buttons, full-width "Submit Answer" CTA. Triage prompt
// re-docked top-center per §5.4.
//
// Owns:
// - the useReducer state (shell-reducer.ts)
// - the requestAnimationFrame tick loop (dispatches `tick` every frame)
// - the Space-key listener for triage-take (only fires when the triage
//   prompt is visible — see commit 3 / plan §3.2). The real CCAT has
//   NO keyboard shortcuts; the Space-on-triage shortcut survives only
//   because the triage prompt is our pedagogical layer, not CCAT
//   mechanics. Digit / letter / Enter shortcuts were stripped in
//   commit 3 / plan §3.0.
// - the async server-action calls (onSubmitAttempt, onEndSession)
//
// Renders:
// - chrome row: chronometer top-right + session-progress bar +
//   "Question N / 50" + cosmetic last-question indicator
// - content area: per-question timer + block depletion above the
//   <ItemSlot> (latency-anchor host, KEYED on currentItem.id), then
//   the full-width Submit Answer CTA
// - overlays: <TriagePrompt> (top-center), <InterQuestionCard>,
//   <Heartbeat> (sibling to <ItemSlot>)
//
// The diagnostic overtime-note machinery was removed in this commit —
// the diagnostic now hard-stops at 15 minutes server-side
// (commit 1's `submitAttempt` cutoff). The cosmetic last-question
// indicator below replaces the soft note.

import * as errors from "@superbuilders/errors"
import * as React from "react"
import { Heartbeat } from "@/components/focus-shell/heartbeat"
import { InterQuestionCard } from "@/components/focus-shell/inter-question-card"
import { ItemSlot } from "@/components/focus-shell/item-slot"
import { PaceTrack } from "@/components/focus-shell/pace-track"
import { QuestionBlockDepletion } from "@/components/focus-shell/question-block-depletion"
import { QuestionTimerBar } from "@/components/focus-shell/question-timer-bar"
import { SessionTimerBar, formatRemaining } from "@/components/focus-shell/session-timer-bar"
import {
	type TickContext,
	initShellState,
	makeReducer
} from "@/components/focus-shell/shell-reducer"
import { TriagePrompt } from "@/components/focus-shell/triage-prompt"
import type { FocusShellProps, SubmitAttemptInput } from "@/components/focus-shell/types"
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

	// requestAnimationFrame tick loop — drives elapsed values and
	// triage-prompt firing. The diagnostic-overtime-note check that
	// previously also lived here was removed in commit 2 (see file
	// header).
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

	// Space-key listener for triage-take. Per plan §3.2, this is the
	// only keyboard shortcut in the focus shell. Fires only when the
	// triage prompt is visible (`triagePromptFired === true`); when the
	// prompt is hidden, Space does nothing (no submit, no select). The
	// reducer's own `submitPending` guard is the secondary defense
	// against double-take.
	//
	// `event.code === "Space"` is layout-independent (Dvorak / AZERTY
	// users get the same physical key). `event.key === " "` is the
	// fallback for environments where `code` is unavailable.
	React.useEffect(function attachTriageKeyboard() {
		function onKey(event: KeyboardEvent) {
			const target = event.target
			if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
				return
			}
			// `event.code === "Space"` is layout-independent (Dvorak / AZERTY
			// users get the same physical key). `event.key === " "` is the
			// fallback for environments where `code` is unavailable. The
			// boolean OR sits inside an `if` test (allowed by
			// no-logical-or-fallback rule's "boolean conditionals" carve-out)
			// rather than being assigned to a const.
			if (event.code !== "Space" && event.key !== " ") return
			if (!stateRef.current.triagePromptFired) return
			event.preventDefault()
			if (stateRef.current.submitPending) return
			dispatch({ kind: "triage_take", nowMs: performance.now() })
		}
		window.addEventListener("keydown", onKey)
		return function detachTriageKeyboard() {
			window.removeEventListener("keydown", onKey)
		}
	}, [])

	const sessionDurationMs = props.sessionDurationMs

	// Cosmetic last-question indicator (plan §5.6). Server is the
	// source of truth for the cutoff; this is purely a UI hint flipped
	// when elapsedSessionMs crosses the threshold.
	const isLastQuestion =
		sessionDurationMs !== null &&
		props.sessionType === "diagnostic" &&
		state.elapsedSessionMs >= sessionDurationMs

	// Build the peripheral nodes inside narrowed branches so we don't
	// have to re-check `sessionDurationMs !== null` when passing as a
	// prop. Hidden entirely when the session has no duration (diagnostic
	// pre-commit-4) or the user has toggled the timer off.
	let chronometerNode: React.ReactNode = null
	let sessionBarNode: React.ReactNode = null
	let paceTrackNode: React.ReactNode = null
	if (sessionDurationMs !== null && state.timerPrefs.sessionTimerVisible) {
		const readout = formatRemaining(sessionDurationMs, state.elapsedSessionMs)
		chronometerNode = (
			<span className="font-bold text-5xl text-foreground tabular-nums tracking-tight md:text-6xl">
				{readout}
			</span>
		)
		sessionBarNode = (
			<SessionTimerBar sessionId={props.sessionId} durationMs={sessionDurationMs} />
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

	const questionNumber = props.targetQuestionCount - state.questionsRemaining + 1
	const lastQuestionSuffix = isLastQuestion ? " — last question" : ""

	const strictModeAttr = String(props.strictMode)

	const submitDisabled = state.submitPending

	return (
		<div
			data-strict-mode={strictModeAttr}
			className={cn("flex min-h-dvh w-full flex-col px-6 py-8")}
		>
			<main className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
				{/* chrome row — chronometer top-right, then progress bar,
				    then "Question N / 50" + cosmetic last-question
				    indicator + thin divider. */}
				{chronometerNode !== null ? (
					<div className="mb-4 flex justify-end">{chronometerNode}</div>
				) : null}
				{sessionBarNode}
				{paceTrackNode !== null ? <div className="mt-1">{paceTrackNode}</div> : null}
				<div className="mt-2 text-foreground/70 text-sm">
					Question <strong className="text-foreground">{questionNumber}</strong>
					{" / "}
					{props.targetQuestionCount}
					{lastQuestionSuffix}
				</div>
				<hr className="mt-3 border-foreground/10" />

				{/* content area — per-question timer + block depletion as
				    framing chrome above the question, then the question
				    text + options inside <ItemSlot>, then the full-width
				    Submit Answer CTA. */}
				<div className="mt-8 flex flex-col gap-6">
					<div className="flex flex-col gap-2">
						{questionTimerNode}
						<QuestionBlockDepletion elapsedQuestionMs={state.elapsedQuestionMs} />
					</div>
					{/*
					 * LOAD-BEARING: do not remove the `key={state.currentItem.id}`
					 * prop. The keyed mount is what re-runs <ItemSlot>'s mount
					 * effect, which captures `performance.now()` at first paint
					 * of every new item and dispatches `set_question_started` —
					 * the latency anchor. The 5-minute tripwire in
					 * src/server/sessions/submit.ts is the safety net; this key
					 * is the contract.
					 * See docs/plans/phase-3-practice-surface.md §9.1 +
					 * docs/plans/phase-3-polish-practice-surface-features.md §5.5.
					 */}
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
					<button
						type="button"
						onClick={function clickSubmit() {
							if (state.submitPending) return
							dispatch({ kind: "submit", nowMs: performance.now() })
						}}
						disabled={submitDisabled}
						className={cn(
							// Solid blue per the target screenshots (the indigo-ish tone in
							// example_03/04). `bg-blue-600` matches the closest Tailwind token.
							// Disabled state collapses to neutral gray via opacity-50.
							"w-full rounded-md bg-blue-600 px-6 py-4 font-medium text-base text-white transition-colors",
							"hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
							"disabled:cursor-not-allowed disabled:opacity-50"
						)}
					>
						Submit Answer
					</button>
				</div>
			</main>

			{/* overlays — outside the central column. */}
			<TriagePrompt
				visible={state.triagePromptFired}
				ifThenPlan={props.ifThenPlan}
				onTake={function takeTriage() {
					dispatch({ kind: "triage_take", nowMs: performance.now() })
				}}
			/>
			<InterQuestionCard visible={state.interQuestionVisible} />
			<Heartbeat sessionId={props.sessionId} />
		</div>
	)
}

export type { FocusShellProps }
export { FocusShell }
