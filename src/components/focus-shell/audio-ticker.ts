"use client"

// audio-ticker — synthetic per-question countdown audio. Web Audio API
// directly (OscillatorNode + GainNode); no audio file dependencies.
//
// Browser autoplay policy gates AudioContext creation behind a user
// interaction. `unlockAudio()` must be called from a click / pointerdown
// / keydown handler. Calls to `playTick` / `playDong` before the
// context is unlocked are silent no-ops (per the spec — "skip
// silently — do not throw, do not log"). Same silent-skip behavior if
// the AudioContext is suspended for any other reason.
//
// Each successful play dispatches a `window.CustomEvent('audio-ticker',
// { detail: { kind, timestampMs } })` so verification harnesses can
// observe call timing without reaching into module internals. Pure
// no-op in production when nothing listens.
//
// The unlock latch is module-scope. Once unlocked, all subsequent
// FocusShell mounts in the same browser session reuse the same
// AudioContext.

import * as errors from "@superbuilders/errors"

let ctx: AudioContext | undefined

function unlockAudio(): void {
	if (typeof window === "undefined") return
	if (ctx !== undefined) return
	if (typeof AudioContext === "undefined") return
	const result = errors.trySync(function makeCtx() { return new AudioContext() })
	if (result.error) return
	ctx = result.data
}

function emitEvent(kind: "tick" | "dong"): void {
	if (typeof window === "undefined") return
	const detail = { kind, timestampMs: Date.now() }
	window.dispatchEvent(new CustomEvent("audio-ticker", { detail }))
}

function playTick(): void {
	if (ctx === undefined) return
	if (ctx.state !== "running") return
	const result = errors.trySync(function play() {
		const audioCtx = ctx
		if (audioCtx === undefined) return
		const now = audioCtx.currentTime
		const osc = audioCtx.createOscillator()
		const gain = audioCtx.createGain()
		osc.type = "sine"
		osc.frequency.value = 880
		gain.gain.setValueAtTime(0, now)
		gain.gain.linearRampToValueAtTime(0.12, now + 0.005)
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
		osc.connect(gain).connect(audioCtx.destination)
		osc.start(now)
		osc.stop(now + 0.06)
	})
	if (result.error) return
	emitEvent("tick")
}

function playDong(): void {
	if (ctx === undefined) return
	if (ctx.state !== "running") return
	const result = errors.trySync(function play() {
		const audioCtx = ctx
		if (audioCtx === undefined) return
		const now = audioCtx.currentTime
		const osc = audioCtx.createOscillator()
		const gain = audioCtx.createGain()
		osc.type = "sine"
		osc.frequency.value = 220
		gain.gain.setValueAtTime(0, now)
		gain.gain.linearRampToValueAtTime(0.3, now + 0.01)
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
		osc.connect(gain).connect(audioCtx.destination)
		osc.start(now)
		osc.stop(now + 0.32)
	})
	if (result.error) return
	emitEvent("dong")
}

export { playDong, playTick, unlockAudio }
