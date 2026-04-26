// biome-ignore-all lint/style/noProcessEnv: drizzle.config runs under the shim that injects DATABASE_URL
import type { Config } from "drizzle-kit"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
	throw new Error("DATABASE_URL not set; run drizzle-kit via the shim (bun db:push, db:migrate, …)")
}

export default {
	schema: "./src/db/schemas/**/*.ts",
	dialect: "postgresql",
	dbCredentials: {
		url: databaseUrl
	}
} satisfies Config
