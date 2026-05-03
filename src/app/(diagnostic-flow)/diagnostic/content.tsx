"use client"

// /diagnostic content — consumes the startSession promise from page.tsx
// via React.use() and mounts the FocusShell with diagnostic config.
//
// Plan §6.1. Diagnostic config:
//   - sessionDurationMs: null  (commit 4 wires DIAGNOSTIC_SESSION_DURATION_MS
//     here; until then the chronometer/progress bar are hidden in the
//     diagnostic flow and only the drill flow renders them)
//   - paceTrackVisible: false  (the diagnostic is not paced)
//   - perQuestionTargetMs: 18000 (so the triage prompt still fires)
//   - targetQuestionCount: 50  (matches diagnosticMix.length)
//   - questionTimerVisible: true (commit 2 default flip — see plan §3.2 / §5.2)
//
// On the last submit, the FocusShell's `onEndSession` callback is what
// fires the action. The action itself triggers `masteryRecomputeWorkflow`
// from src/server/sessions/end.ts. After endSession resolves, we
// router.push to /post-session/<sessionId> for the onboarding capture.
//
// `recordDiagnosticOvertimeNote` was deleted in commit 2 — the
// diagnostic now hard-stops at 15 minutes server-side
// (commit 1's `submitAttempt` cutoff), replacing the soft "you went
// over" note that this prop fired.

import { useRouter } from "next/navigation"
import * as React from "react"
import { endSession, submitAttempt } from "@/app/(app)/actions"
import { FocusShell } from "@/components/focus-shell/focus-shell"
import type { ItemForRender, SubmitAttemptInput } from "@/components/focus-shell/types"

interface SessionPromise {
	sessionId: string
	firstItem: ItemForRender
}

interface DiagnosticContentProps {
	sessionPromise: Promise<SessionPromise>
}

function DiagnosticContent(props: DiagnosticContentProps) {
	const { sessionId, firstItem } = React.use(props.sessionPromise)
	const router = useRouter()

	const onSubmitAttempt = React.useCallback(
		function onSubmitAttempt(input: SubmitAttemptInput) {
			return submitAttempt(input)
		},
		[]
	)

	const onEndSession = React.useCallback(
		async function onEndSession() {
			await endSession(sessionId)
			router.push(`/post-session/${sessionId}`)
		},
		[sessionId, router]
	)

	return (
		<FocusShell
			sessionId={sessionId}
			sessionType="diagnostic"
			sessionDurationMs={null}
			perQuestionTargetMs={18_000}
			targetQuestionCount={50}
			paceTrackVisible={false}
			initialTimerPrefs={{ sessionTimerVisible: true, questionTimerVisible: true }}
			initialItem={firstItem}
			strictMode={false}
			onSubmitAttempt={onSubmitAttempt}
			onEndSession={onEndSession}
		/>
	)
}

export { DiagnosticContent }
