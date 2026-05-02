import NextAuth from "next-auth"
import authConfig from "@/auth.config"

const PUBLIC_PREFIXES: ReadonlyArray<string> = [
	"/api/auth",
	"/login",
	"/api/health",
	"/api/cron"
]

const { auth } = NextAuth(authConfig)

const middleware = auth(function middlewareHandler(req) {
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

const config = {
	matcher: ["/((?!_next/static|_next/image|favicon).*)"]
}

export default middleware
export { config }
