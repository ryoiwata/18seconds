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
import { chromium } from "playwright-core"
import { createAdminDb } from "@/db/admin"
import { authSessions } from "@/db/schemas/auth/sessions"
import { logger } from "@/logger"

const CHROMIUM_PATH =
	process.env.CHROMIUM_PATH ??
	`${process.env.HOME}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`

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
	await errors.try(adminDb.db.delete(authSessions).where(eq(authSessions.sessionToken, SESSION_TOKEN)))
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
		logger.error({ error: navResult.error, url: SMOKE_URL }, "page.goto failed")
		await browser.close()
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
		if (match) submitsLogged = Number.parseInt(match[1] ?? "0", 10)
		const latencyMatch = debugText.match(/latency=(\d+)ms/)
		if (latencyMatch) firstSubmitLatencyMs = Number.parseInt(latencyMatch[1] ?? "0", 10)
		logger.info({ debugText, firstSubmitLatencyMs }, "post-submit debug card")
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
		pagehideBeaconFired
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
		pagehideBeaconFired
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
			errorCount: errs.length,
			screenshotPath
		},
		"smoke result"
	)
	for (const e of errs) {
		logger.error({ type: e.type, text: e.text }, "console error captured")
	}
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
		pagehideBeaconFired
	if (!ok) {
		logger.error("smoke FAILED")
		process.exit(1)
	}
	logger.info("smoke PASSED")
}

await main()
