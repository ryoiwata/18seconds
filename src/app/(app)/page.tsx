// (app)/page.tsx — placeholder home for commit 4.
//
// The full Mastery Map (with the eleven-icon grid, near-goal line,
// triage adherence indicator, and recommended-next-session CTA) lands
// in commit 5 per plan §10. For now this page renders a confirmation
// that the gate has passed, plus a link into a default drill so the
// user can proceed to commit 5's drill flow once it lands.
//
// The drill link is rendered as a plain <a href> rather than <Link>
// because the /drill/[subTypeId] route doesn't exist yet (commit 5),
// and `typedRoutes: true` in next.config.ts would reject the typed
// <Link href>. Plain <a> is untyped so it compiles; commit 5 swaps
// this entire page out for the real <MasteryMap>.

import { Button } from "@/components/ui/button"

function Page() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-6 py-12">
			<div className="space-y-2 text-center">
				<h1 className="font-semibold text-2xl tracking-tight">Diagnostic complete</h1>
				<p className="text-muted-foreground text-sm">
					The full Mastery Map lands in commit 5. For now, jump straight into a
					drill.
				</p>
			</div>
			<Button asChild>
				<a href="/drill/verbal.synonyms">Start drill: Synonyms</a>
			</Button>
		</main>
	)
}

export default Page
