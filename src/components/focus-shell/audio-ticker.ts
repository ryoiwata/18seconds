"use client"

// audio-ticker — urgency-loop audio for the focus shell.
//
// Single rule (SPEC §6.12, post-overhaul-fixes round): at session start,
// pick one MP3 file at random from the bank manifest at
// src/config/sound-bank.ts. When the per-question target elapses, start
// the chosen file looping. Stop on advance. Same file replays for every
// question in the same session; a hard refresh re-picks.
//
// Browser autoplay policy gates AudioContext creation behind a user
// interaction. `unlockAudio()` must be called from a click / pointerdown
// / keydown handler. Calls to startUrgencyLoop / stopUrgencyLoop before
// the context is unlocked OR before the buffer has decoded are silent
// no-ops — silent failure is the correct behavior per SPEC §6.12.
//
// Each lifecycle event dispatches a window CustomEvent for harness
// instrumentation (`urgency-loop-start`, `urgency-loop-stop`). Pure no-op
// in production when nothing listens.
//
// Module-state lifetime: AudioContext, buffer, and chosen URL persist
// for the lifetime of the page. A hard refresh re-runs `pickSessionSound`
// and re-picks. There is no per-page-navigation re-pick because focus
// shell mounts only on dedicated drill / diagnostic / etc. routes — a
// soft navigation between sessions is not a supported flow today.

import * as errors from "@superbuilders/errors"
import { logger } from "@/logger"
import { SOUND_BANK_URLS } from "@/config/sound-bank"

let audioCtx: AudioContext | undefined
let sessionAudioBuffer: AudioBuffer | undefined
let sessionAudioBufferUrl: string | undefined
let activeSourceNode: AudioBufferSourceNode | undefined

const PEAK_GAIN = 0.8

function pickSessionSound(): string | undefined {
	if (SOUND_BANK_URLS.length === 0) {
		logger.warn({}, "audio-ticker: SOUND_BANK_URLS is empty; urgency loop will be silent")
		return undefined
	}
	const idx = Math.floor(Math.random() * SOUND_BANK_URLS.length)
	const url = SOUND_BANK_URLS[idx]
	if (url === undefined) {
		logger.error({ idx, length: SOUND_BANK_URLS.length }, "audio-ticker: pickSessionSound index out of range")
		return undefined
	}
	return url
}

async function loadBuffer(ctx: AudioContext, url: string): Promise<void> {
	const fetchResult = await errors.try(fetch(url))
	if (fetchResult.error) {
		logger.warn(
			{ error: fetchResult.error, url },
			"audio-ticker: fetch failed; urgency loop will be silent"
		)
		return
	}
	const response = fetchResult.data
	if (!response.ok) {
		logger.warn(
			{ status: response.status, url },
			"audio-ticker: fetch non-2xx; urgency loop will be silent"
		)
		return
	}
	const bufferResult = await errors.try(response.arrayBuffer())
	if (bufferResult.error) {
		logger.warn(
			{ error: bufferResult.error, url },
			"audio-ticker: arrayBuffer failed; urgency loop will be silent"
		)
		return
	}
	const decodeResult = await errors.try(ctx.decodeAudioData(bufferResult.data))
	if (decodeResult.error) {
		logger.warn(
			{ error: decodeResult.error, url },
			"audio-ticker: decodeAudioData failed; urgency loop will be silent"
		)
		return
	}
	sessionAudioBuffer = decodeResult.data
	sessionAudioBufferUrl = url
	logger.debug(
		{ url, durationSec: sessionAudioBuffer.duration },
		"audio-ticker: session sound buffer ready"
	)
}

function unlockAudio(): void {
	if (typeof window === "undefined") return
	if (audioCtx !== undefined) return
	if (typeof AudioContext === "undefined") return
	const result = errors.trySync(function makeCtx() {
		return new AudioContext()
	})
	if (result.error) {
		logger.warn({ error: result.error }, "audio-ticker: AudioContext creation failed")
		return
	}
	audioCtx = result.data
	const url = pickSessionSound()
	if (url === undefined) return
	// Fire-and-forget the buffer load. The startUrgencyLoop call will
	// silently no-op if the buffer hasn't finished decoding by the time
	// the per-question target fires (e.g., very fast first-question
	// triage on a slow connection); the next question will catch up.
	const ctx = audioCtx
	loadBuffer(ctx, url).catch(function noop() {
		// errors.try inside loadBuffer already logs; nothing to do here.
	})
}

function emitEvent(kind: "urgency-loop-start" | "urgency-loop-stop", url?: string): void {
	if (typeof window === "undefined") return
	const detail = { kind, timestampMs: Date.now(), url }
	window.dispatchEvent(new CustomEvent("audio-ticker", { detail }))
}

function startUrgencyLoop(): void {
	if (audioCtx === undefined) return
	if (audioCtx.state !== "running") return
	if (sessionAudioBuffer === undefined) {
		logger.debug({}, "audio-ticker: startUrgencyLoop called before buffer ready; no-op")
		return
	}
	if (activeSourceNode !== undefined) {
		// Defensive: a previous loop is still active. Stop it first to
		// avoid stacking sources on top of each other.
		const prev = activeSourceNode
		const stopResult = errors.trySync(function stopPrev() {
			prev.stop()
		})
		if (stopResult.error) {
			logger.warn(
				{ error: stopResult.error },
				"audio-ticker: failed to stop previous source before starting new one"
			)
		}
		activeSourceNode = undefined
	}
	const ctx = audioCtx
	const buf = sessionAudioBuffer
	const result = errors.trySync(function play() {
		const source = ctx.createBufferSource()
		const gain = ctx.createGain()
		source.buffer = buf
		source.loop = true
		gain.gain.setValueAtTime(PEAK_GAIN, ctx.currentTime)
		source.connect(gain).connect(ctx.destination)
		source.start(0)
		activeSourceNode = source
	})
	if (result.error) {
		logger.warn({ error: result.error }, "audio-ticker: startUrgencyLoop play failed")
		return
	}
	emitEvent("urgency-loop-start", sessionAudioBufferUrl)
}

function stopUrgencyLoop(): void {
	if (activeSourceNode === undefined) return
	const node = activeSourceNode
	activeSourceNode = undefined
	const result = errors.trySync(function stop() {
		node.stop()
	})
	if (result.error) {
		logger.warn({ error: result.error }, "audio-ticker: stopUrgencyLoop failed")
		return
	}
	emitEvent("urgency-loop-stop")
}

export { pickSessionSound, startUrgencyLoop, stopUrgencyLoop, unlockAudio }
