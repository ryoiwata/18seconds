// /diagnostic — pre-diagnostic explainer page.
//
// Phase 3 polish commit 3 split the original /diagnostic into an
// explainer (this file) + the actual session route (`/diagnostic/run`).
// See docs/plans/phase-3-polish-practice-surface-features.md §6.1.
//
// Server component, NOT async per
// rules/rsc-data-fetching-patterns.md. The (app)/layout.tsx diagnostic
// gate's redirect target stays `/diagnostic` — users who haven't
// completed a diagnostic land here first, read the framing, then click
// "Start Diagnostic" to enter the session at `/diagnostic/run`.
//
// No `alpha-style` skin (parent-plan §11 forward note: focus-shell-
// aesthetic family). Match the focus-shell's typographic register —
// foreground / muted-foreground / subtle borders — so the visual
// transition into `/diagnostic/run` is continuous.

// `next/link` typed-routes (next.config.ts: typedRoutes: true) reject
// the forward-reference to `/diagnostic/run` because the route was
// added in the same commit — its typed-route entry hasn't propagated
// yet. Following the precedent in
// docs/plans/phase-3-practice-surface.md §11.1 (commit 4 used the
// same workaround for `/drill/[subTypeId]`), use a plain `<a>` tag
// for the forward-reference. Once the typed-routes cache catches up
// post-build, a future commit can swap this back to <Link>.

function Page() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-stretch justify-center px-6 py-16">
			<header className="space-y-3">
				<h1 className="font-semibold text-3xl tracking-tight">
					Welcome to the diagnostic.
				</h1>
				<p className="text-foreground/70 text-sm">
					Read this once. It will not be shown again.
				</p>
			</header>

			<ul className="mt-10 space-y-4 text-base">
				<li className="flex items-start gap-3">
					<span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/60" />
					<span>
						<strong className="font-semibold">50 questions in 15 minutes.</strong>{" "}
						This is the same pacing the real CCAT uses.
					</span>
				</li>
				<li className="flex items-start gap-3">
					<span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/60" />
					<span>
						The diagnostic is designed to train your{" "}
						<strong className="font-semibold">triage discipline</strong> —
						knowing when to abandon a question and move on.
					</span>
				</li>
				<li className="flex items-start gap-3">
					<span aria-hidden="true" className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/60" />
					<span>
						You are not expected to finish all 50.{" "}
						<strong className="font-semibold">That's by design.</strong> The
						clock is the test; what you finish is your baseline.
					</span>
				</li>
			</ul>

			<div className="mt-12">
				<a
					href="/diagnostic/run"
					className="inline-flex w-full items-center justify-center rounded-md bg-primary px-6 py-4 font-medium text-base text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					Start Diagnostic
				</a>
			</div>
		</main>
	)
}

export default Page
