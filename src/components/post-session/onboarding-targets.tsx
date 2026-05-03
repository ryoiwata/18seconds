"use client"

// <OnboardingTargets> — single-purpose form rendered by
// <PostSessionShell> on the diagnostic post-session screen.
//
// Plan §6.2 / §3.7. Captures:
//   - target percentile from the discrete set { 50, 30, 20, 10, 5 }.
//   - target date (date picker → unix-ms timestamp).
//
// Two submit paths:
//   "Save and continue" — submits the form, action writes both columns,
//   then router.push('/').
//   "Skip for now"      — router.push('/') without writing. The
//                          users.target_percentile / target_date_ms
//                          columns stay null.
//
// `saveOnboardingTargets` is the canonical action surface (lives in
// src/app/(app)/actions.ts). It's reachable from this client component
// via a direct import per Next.js Server Actions semantics.

import { useRouter } from "next/navigation"
import * as React from "react"
import { saveOnboardingTargets } from "@/app/(app)/actions"
import { Button } from "@/components/ui/button"
import { logger } from "@/logger"

const TARGET_PERCENTILES = [50, 30, 20, 10, 5] as const
type TargetPercentile = (typeof TARGET_PERCENTILES)[number]

function isPercentile(n: number): n is TargetPercentile {
	for (const v of TARGET_PERCENTILES) {
		if (v === n) return true
	}
	return false
}

function OnboardingTargets() {
	const router = useRouter()
	const [percentile, setPercentile] = React.useState<TargetPercentile | null>(null)
	const [dateString, setDateString] = React.useState<string>("")
	const [submitting, setSubmitting] = React.useState(false)

	async function onSave() {
		setSubmitting(true)
		const targetDateMs = dateString === "" ? undefined : Date.parse(dateString)
		const targetPercentile = percentile === null ? undefined : percentile
		const validDate = targetDateMs !== undefined && Number.isFinite(targetDateMs)
		const finalDate = validDate ? targetDateMs : undefined
		const result = await saveOnboardingTargets({
			targetPercentile,
			targetDateMs: finalDate
		}).catch(function onErr(error: unknown) {
			logger.error({ error }, "OnboardingTargets: saveOnboardingTargets threw")
			return null
		})
		if (result === null) {
			setSubmitting(false)
			return
		}
		router.push("/")
	}

	function onSelectPercentile(value: string) {
		const n = Number.parseInt(value, 10)
		if (!Number.isFinite(n) || !isPercentile(n)) {
			setPercentile(null)
			return
		}
		setPercentile(n)
	}

	const percentileSelectValue = percentile === null ? "" : String(percentile)
	const submitLabel = submitting ? "Saving…" : "Save and continue"

	return (
		<form
			className="space-y-6"
			onSubmit={async function onSubmit(event) {
				event.preventDefault()
				await onSave()
			}}
		>
			<div className="space-y-2">
				<label className="block font-medium text-sm" htmlFor="onboarding-percentile">
					Target percentile
				</label>
				<select
					id="onboarding-percentile"
					name="percentile"
					value={percentileSelectValue}
					onChange={function onPercentileChange(event) {
						onSelectPercentile(event.target.value)
					}}
					className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<option value="">Select…</option>
					{TARGET_PERCENTILES.map(function renderOption(p) {
						return (
							<option key={p} value={p}>
								Top {p}%
							</option>
						)
					})}
				</select>
			</div>

			<div className="space-y-2">
				<label className="block font-medium text-sm" htmlFor="onboarding-date">
					Target date
				</label>
				<input
					id="onboarding-date"
					name="targetDate"
					type="date"
					value={dateString}
					onChange={function onDateChange(event) {
						setDateString(event.target.value)
					}}
					className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</div>

			<div className="flex items-center justify-between gap-4">
				<button
					type="button"
					onClick={function onSkip() {
						router.push("/")
					}}
					className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
				>
					Skip for now
				</button>
				<Button type="submit" disabled={submitting}>
					{submitLabel}
				</Button>
			</div>
		</form>
	)
}

export type { TargetPercentile }
export { OnboardingTargets, TARGET_PERCENTILES }
