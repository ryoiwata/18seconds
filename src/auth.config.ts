import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"

// Edge-safe slice of the Auth.js config used by src/middleware.ts.
// Must NOT import the Drizzle adapter (or anything that pulls in pg) —
// middleware runs in the Edge runtime and would crash on Node-only code.
const authConfig = {
	providers: [Google]
} satisfies NextAuthConfig

export default authConfig
