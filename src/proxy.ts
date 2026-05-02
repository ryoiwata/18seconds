import { auth } from "@/auth"

const PUBLIC_PREFIXES: ReadonlyArray<string> = [
	"/api/auth",
	"/login",
	"/api/health",
	"/api/cron",
	// /api/admin/* is for scripted/curl access. Each route MUST self-guard
	// (currently with `Authorization: Bearer ${CRON_SECRET}`). Form-based admin
	// flows go through server actions under /admin/*, which do session +
	// admin-allowlist checks via requireAdminEmail() — not this prefix.
	"/api/admin"
]

const proxy = auth(function proxyHandler(req) {
	const path = req.nextUrl.pathname
	for (const prefix of PUBLIC_PREFIXES) {
		if (path.startsWith(prefix)) {
			return undefined
		}
	}
	if (!req.auth) {
		const loginUrl = new URL("/login", req.nextUrl.origin)
		return Response.redirect(loginUrl)
	}
	return undefined
})

// `config` must be inline `export const` — Next.js statically parses it from
// the AST at build time and cannot follow re-exports.
export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon).*)"]
}

export { proxy }
