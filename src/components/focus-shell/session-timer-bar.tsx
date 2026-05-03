"use client"

// <SessionTimerBar> — the full-session countdown bar. Pure CSS
// animation; the JS reducer's elapsed value is used only for the
// numeric readout (mm:ss). SPEC §6.6 / PRD §5.1.

import { TimerBar } from "@/components/focus-shell/timer-bar"

interface SessionTimerBarProps {
	sessionId: string
	durationMs: number
	elapsedMs: number
}

function formatRemaining(durationMs: number, elapsedMs: number): string {
	const remaining = Math.max(0, durationMs - elapsedMs)
	const totalSeconds = Math.floor(remaining / 1000)
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	const minutesStr = String(minutes)
	const secondsStr = String(seconds).padStart(2, "0")
	return `${minutesStr}:${secondsStr}`
}

function SessionTimerBar(props: SessionTimerBarProps) {
	const readout = formatRemaining(props.durationMs, props.elapsedMs)
	return (
		<div className="flex w-full items-center gap-2 opacity-30">
			{/* `key={props.sessionId}` so a remount restarts the animation if
			    the session changes. Within a single session the key is
			    stable; the animation runs to completion uninterrupted. */}
			<TimerBar key={props.sessionId} durationMs={props.durationMs} />
			<span className="font-mono text-foreground text-xs tabular-nums">{readout}</span>
		</div>
	)
}

export type { SessionTimerBarProps }
export { SessionTimerBar, formatRemaining }
