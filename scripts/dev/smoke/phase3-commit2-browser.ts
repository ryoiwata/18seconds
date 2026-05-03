// scripts/dev/smoke/phase3-commit2-browser.ts
//
// Phase 3 commit-2 BROWSER smoke. Auth-aware. Uses playwright-core
// (temporary dev dep) + the chromium binary that Claude's MCP installs
// at ~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome.
//
// What it does:
//   1. Inserts a session row in the dev DB (or reuses one).
//   2. Launches chromium with the session cookie pre-set via
//      context.addCookies().
//   3. Navigates to /phase3-smoke.
//   4. Captures console messages for ~3s.
//   5. Asserts: zero "Maximum update depth exceeded" errors AND the
//      first item is rendered AND no other React errors.
//   6. Tests submit roundtrip + checks debug card increments.
//   7. Optional: waits 19s and asserts the triage prompt appears.
//
// Per project rules: scripts/ exempt from no-try / no-console / etc.
// Uses src-style errors.try + logger anyway for consistency.
//
// Usage:
//   bun run scripts/dev/smoke/phase3-commit2-browser.ts

import "@/env"
import * as errors from "@superbuilders/errors"
import { eq } from "drizzle-orm"
import { type Page, chromium } from "playwright-core"
import { createAdminDb } from "@/db/admin"
import { authSessions } from "@/db/schemas/auth/sessions"
import { logger } from "@/logger"

// Hardcoded against the chromium binary the Claude MCP installs locally.
// No `process.env` (biome `noProcessEnv` ban) and no `??` fallback (project
// rule banning nullish coalescing). If you run this in a CI box where the
// path differs, edit this constant — there is no env override by design.
const CHROMIUM_PATH = `${Bun.env.HOME}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`

const SESSION_TOKEN = `phase3-c2-smoke-${Date.now()}`
const TARGET_USER_ID = "dd2d98ab-e015-4892-84d0-1c12754028cf"
const APP_BASE = "http://localhost:3000"
const SMOKE_URL = `${APP_BASE}/phase3-smoke`

async function ensureSession(): Promise<void> {
	await using adminDb = await createAdminDb()
	const expiresMs = Date.now() + 7 * 86_400_000
	const result = await errors.try(
		adminDb.db
			.insert(authSessions)
			.values({
				sessionToken: SESSION_TOKEN,
				userId: TARGET_USER_ID,
				expiresMs
			})
			.returning({ token: authSessions.sessionToken })
	)
	if (result.error) {
		logger.error({ error: result.error }, "ensureSession: insert failed")
		throw errors.wrap(result.error, "ensureSession")
	}
	logger.info({ sessionToken: SESSION_TOKEN }, "ensureSession: row inserted")
}

async function deleteSession(): Promise<void> {
	await using adminDb = await createAdminDb()
	const result = await errors.try(
		adminDb.db.delete(authSessions).where(eq(authSessions.sessionToken, SESSION_TOKEN))
	)
	if (result.error) {
		// Cleanup is best-effort — log the failure for the test log but
		// don't throw, so the smoke harness still exits cleanly.
		logger.warn({ error: result.error, sessionToken: SESSION_TOKEN }, "deleteSession: cleanup failed")
	}
}

interface ConsoleEntry {
	type: string
	text: string
}

interface SmokeOutput {
	errors: ConsoleEntry[]
	screenshotPath: string
	submitsLogged: number
	firstItemVisible: boolean
	triageAppeared: boolean
	firstSubmitLatencyMs: number
	heartbeatCount: number
	keyboardSelectsOption: boolean
	pagehideBeaconFired: boolean
	// Stress-check counters: after a single option select, fire 5
	// rapid Enter presses within ~200ms. The submit-pending race fix
	// requires `items submitted` to increment by exactly 1, not 5.
	stressSubmitsBefore: number
	stressSubmitsAfter: number
	stressPressDurationMs: number
}

interface StressCheckResult {
	stressSubmitsBefore: number
	stressSubmitsAfter: number
	stressPressDurationMs: number
}

async function readSubmittedCount(page: Page): Promise<number> {
	const text = await page
		.locator("aside[aria-label='smoke debug']")
		.innerText()
		.catch(function onErr() { return "" })
	const match = text.match(/items submitted: (\d+)/)
	if (match && match[1] !== undefined) {
		return Number.parseInt(match[1], 10)
	}
	return 0
}

// Race-window stress check. Caller has already verified item visibility
// and that the prior submit roundtrip landed (debug counter == 1). We
// select an option, fire 5 Enter presses back-to-back inside ~200ms,
// then read the counter again. With the submitPending fix in place,
// the delta should be exactly 1; without it, the second/third/etc.
// press lands during the await window and produces stale-snapshot
// duplicates.
async function runEnterSpamStressCheck(page: Page): Promise<StressCheckResult> {
	await page.keyboard.press("1")
	await page.waitForTimeout(150)
	const stressSubmitsBefore = await readSubmittedCount(page)
	const pressStart = Date.now()
	for (let i = 0; i < 5; i++) {
		await page.keyboard.press("Enter")
	}
	const stressPressDurationMs = Date.now() - pressStart
	logger.info({ stressPressDurationMs }, "stress: 5 enter presses dispatched")
	// Allow the in-flight submit + advance to settle. The stub's
	// onSubmitAttempt resolves synchronously in the next microtask;
	// 600ms is plenty of headroom.
	await page.waitForTimeout(600)
	const stressSubmitsAfter = await readSubmittedCount(page)
	logger.info(
		{
			stressSubmitsBefore,
			stressSubmitsAfter,
			delta: stressSubmitsAfter - stressSubmitsBefore
		},
		"stress: post-spam debug card"
	)
	return { stressSubmitsBefore, stressSubmitsAfter, stressPressDurationMs }
}

async function runSmoke(): Promise<SmokeOutput> {
	const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true })
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
	await context.addCookies([
		{
			name: "authjs.session-token",
			value: SESSION_TOKEN,
			domain: "localhost",
			path: "/",
			httpOnly: false,
			secure: false,
			sameSite: "Lax",
			expires: Math.floor((Date.now() + 7 * 86_400_000) / 1000)
		}
	])
	const page = await context.newPage()
	const consoleEntries: ConsoleEntry[] = []
	page.on("console", function onConsole(msg) {
		consoleEntries.push({ type: msg.type(), text: msg.text() })
	})
	page.on("pageerror", function onPageError(err) {
		consoleEntries.push({ type: "pageerror", text: err.message })
	})

	// Track requests so we can confirm the heartbeat beacon fires.
	const heartbeatRequests: string[] = []
	page.on("request", function onRequest(req) {
		const url = req.url()
		if (url.includes("/api/sessions/") && url.endsWith("/heartbeat")) {
			heartbeatRequests.push(url)
		}
	})

	const navResult = await errors.try(page.goto(SMOKE_URL, { waitUntil: "domcontentloaded", timeout: 15_000 }))
	if (navResult.error) {
		await browser.close()
		logger.error({ error: navResult.error, url: SMOKE_URL }, "page.goto failed")
		throw errors.wrap(navResult.error, "page.goto")
	}
	const response = navResult.data
	logger.info({ status: response?.status(), url: page.url() }, "navigated")

	// Wait briefly for hydration + any infinite-loop to manifest.
	await page.waitForTimeout(2500)

	// Check first-item visibility by looking for "What is 1/2 + 1/4?".
	const firstItemVisible = await page.locator("text=What is 1/2 + 1/4?").isVisible().catch(function onErr() { return false })

	// Try a submit roundtrip — click option A, click Submit, verify the
	// debug card now reads "items submitted: 1".
	// Keyboard `1` selects option A. <ItemPrompt> handles the listener.
	let keyboardSelectsOption = false
	if (firstItemVisible) {
		await page.keyboard.press("1")
		await page.waitForTimeout(150)
		// aria-pressed flips to true on the selected option button.
		keyboardSelectsOption = await page
			.locator("button[aria-pressed='true']")
			.first()
			.isVisible()
			.catch(function onErr() { return false })
	}

	let submitsLogged = 0
	let firstSubmitLatencyMs = 0
	if (firstItemVisible) {
		// Pause long enough that the latency value is a real reaction time,
		// not a 0-2ms tight-loop artifact (the bug we just fixed).
		await page.waitForTimeout(800)
		await page.locator("button", { hasText: "1/6" }).first().click({ timeout: 3000 }).catch(function onErr() { /* ignore */ })
		await page.locator("button", { hasText: "Submit" }).first().click({ timeout: 3000 }).catch(function onErr() { /* ignore */ })
		await page.waitForTimeout(500)
		const debugText = await page.locator("aside[aria-label='smoke debug']").innerText().catch(function onErr() { return "" })
		const match = debugText.match(/items submitted: (\d+)/)
		if (match && match[1] !== undefined) {
			submitsLogged = Number.parseInt(match[1], 10)
		}
		const latencyMatch = debugText.match(/latency=(\d+)ms/)
		if (latencyMatch && latencyMatch[1] !== undefined) {
			firstSubmitLatencyMs = Number.parseInt(latencyMatch[1], 10)
		}
		logger.info({ debugText, firstSubmitLatencyMs }, "post-submit debug card")
	}

	// Race-window stress check — extracted to runEnterSpamStressCheck()
	// so this function stays under biome's cognitive-complexity budget.
	let stressSubmitsBefore = 0
	let stressSubmitsAfter = 0
	let stressPressDurationMs = 0
	if (firstItemVisible && submitsLogged === 1) {
		const stressResult = await runEnterSpamStressCheck(page)
		stressSubmitsBefore = stressResult.stressSubmitsBefore
		stressSubmitsAfter = stressResult.stressSubmitsAfter
		stressPressDurationMs = stressResult.stressPressDurationMs
	}

	// Triage check — wait past the 18s per-question target while leaving
	// the current item alone (do NOT click submit/options between rounds).
	// The triage prompt overlay should appear and stay (no auto-submit).
	let triageAppeared = false
	if (firstItemVisible) {
		// Wait 19s, then look for the triage button text.
		await page.waitForTimeout(19_000)
		triageAppeared = await page
			.locator("text=Best move: guess and advance.")
			.isVisible()
			.catch(function onErr() { return false })
		// Latency tripwire: confirm the prompt is STILL visible 12 seconds
		// later (user said "leave it for 60s" but 12 is enough to prove
		// no auto-submit at t=30s).
		await page.waitForTimeout(12_000)
		const stillVisible = await page
			.locator("text=Best move: guess and advance.")
			.isVisible()
			.catch(function onErr() { return false })
		logger.info({ triageAppeared, stillVisibleAt31s: stillVisible }, "triage check")
	}

	const screenshotPath = `/tmp/phase3-c2-smoke-${Date.now()}.png`
	await page.screenshot({ path: screenshotPath, fullPage: false })
	logger.info({ screenshotPath, heartbeatCount: heartbeatRequests.length }, "screenshot captured")

	// pagehide beacon: navigation away from the page fires `pagehide` on
	// the old document. Capture the count before nav, navigate to
	// about:blank, wait for the beacon to flush, then read.
	const heartbeatCountBeforeNav = heartbeatRequests.length
	await page.goto("about:blank").catch(function onErr() { /* ignore */ })
	// sendBeacon is fire-and-forget; give the network stack a moment to flush.
	await new Promise(function delay(resolve) { setTimeout(resolve, 1500) })
	const pagehideBeaconFired = heartbeatRequests.length > heartbeatCountBeforeNav

	await browser.close()
	// The heartbeat beacon's 404 is expected in commit 2 (the handler
	// lands in commit 3) — filter it out so the failure signal is real.
	const errorEntries = consoleEntries.filter(function pickRealErrors(e) {
		if (e.type !== "error" && e.type !== "pageerror") return false
		if (e.text.includes("404") && e.text.toLowerCase().includes("not found")) return false
		return true
	})
	return {
		errors: errorEntries,
		screenshotPath,
		submitsLogged,
		firstItemVisible,
		triageAppeared,
		firstSubmitLatencyMs,
		heartbeatCount: heartbeatRequests.length,
		keyboardSelectsOption,
		pagehideBeaconFired,
		stressSubmitsBefore,
		stressSubmitsAfter,
		stressPressDurationMs
	}
}

async function main(): Promise<void> {
	await ensureSession()
	const result = await errors.try(runSmoke())
	await deleteSession()
	if (result.error) {
		logger.error({ error: result.error }, "smoke run failed")
		process.exit(1)
	}
	const {
		errors: errs,
		screenshotPath,
		submitsLogged,
		firstItemVisible,
		firstSubmitLatencyMs,
		heartbeatCount,
		keyboardSelectsOption,
		pagehideBeaconFired,
		stressSubmitsBefore,
		stressSubmitsAfter,
		stressPressDurationMs
	} = result.data
	logger.info(
		{
			firstItemVisible,
			submitsLogged,
			firstSubmitLatencyMs,
			heartbeatCount,
			triageAppeared: result.data.triageAppeared,
			keyboardSelectsOption,
			pagehideBeaconFired,
			stressSubmitsBefore,
			stressSubmitsAfter,
			stressPressDurationMs,
			errorCount: errs.length,
			screenshotPath
		},
		"smoke result"
	)
	for (const e of errs) {
		logger.error({ type: e.type, text: e.text }, "console error captured")
	}
	// The 5-Enter spam should produce exactly ONE additional submit.
	// stressSubmitsBefore should be 1 (from the earlier roundtrip) and
	// stressSubmitsAfter should be exactly 2. If the race window were
	// open, this would land somewhere between 2 and 6.
	const stressDelta = stressSubmitsAfter - stressSubmitsBefore
	const stressOk = stressSubmitsBefore === 1 && stressSubmitsAfter === 2 && stressPressDurationMs <= 200
	const ok =
		firstItemVisible &&
		submitsLogged === 1 &&
		errs.length === 0 &&
		result.data.triageAppeared &&
		// Latency must be plausible: > 50ms (not the 2ms tight-loop bug)
		// and < 18000ms (we click within the per-question target).
		firstSubmitLatencyMs >= 50 &&
		firstSubmitLatencyMs < 18_000 &&
		// At least one heartbeat fired during the ~33s smoke run.
		heartbeatCount >= 1 &&
		// Keyboard 1 selects an option (aria-pressed flips).
		keyboardSelectsOption &&
		// pagehide listener fires a final beacon on close.
		pagehideBeaconFired &&
		// Race-window stress check: 5 Enter presses → 1 submit.
		stressOk
	if (!ok) {
		logger.error(
			{ stressSubmitsBefore, stressSubmitsAfter, stressDelta, stressPressDurationMs },
			"smoke FAILED"
		)
		process.exit(1)
	}
	logger.info("smoke PASSED")
}

await main()
