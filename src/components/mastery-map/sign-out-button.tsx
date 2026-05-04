// <SignOutButton> — header-area sign-out affordance on the Mastery
// Map. Plan: docs/plans/phase3-drill-mode.md §7 + §11.2.
//
// Form-action shape so the click works without JavaScript: the form
// posts to the server action, NextAuth clears the session + redirects
// to /login server-side, and the user lands on the login page. No
// client-side state, no useTransition needed.
//
// Visual treatment is distinct from the footer's low-contrast triage
// adherence line (per the plan's §11.2 resolution): readable foreground
// at small text size, subtle hover affordance. Sign-out is an action,
// not a status — inherit the action treatment, not the periphery
// treatment.

import { signOutAction } from "@/app/(app)/actions"

function SignOutButton() {
	return (
		<form action={signOutAction}>
			<button
				type="submit"
				data-testid="mastery-map-sign-out"
				className="text-foreground/70 text-sm transition-colors hover:text-foreground"
			>
				Sign out
			</button>
		</form>
	)
}

export { SignOutButton }
