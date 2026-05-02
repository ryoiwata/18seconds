import { Signer } from "@aws-sdk/rds-signer"
import * as errors from "@superbuilders/errors"
import { attachDatabasePool } from "@vercel/functions"
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { AWS_REGION, DATABASE_NAME, DATABASE_USER } from "@/db/constants"
import { RDS_CA_BUNDLE } from "@/db/rds-ca-bundle"
import { type Db, dbSchema } from "@/db/schema"
import { env } from "@/env"
import { logger } from "@/logger"

declare global {
	// Cached across Turbopack hot-reload module re-evaluation; harmless in production
	// since the server isn't hot-reloaded there.
	var __18seconds_pg_pool: Pool | undefined
}

function createLocalPool(connectionString: string): Pool {
	logger.info("creating local docker pg pool")
	return new Pool({
		connectionString,
		max: 10
	})
}

function createRdsPool(): Pool {
	if (!env.AWS_ROLE_ARN || !env.DATABASE_HOST) {
		logger.error(
			{ hasRole: Boolean(env.AWS_ROLE_ARN), hasHost: Boolean(env.DATABASE_HOST) },
			"rds pool needs AWS_ROLE_ARN and DATABASE_HOST when DATABASE_LOCAL_URL is unset"
		)
		throw errors.new(
			"db pool: AWS_ROLE_ARN and DATABASE_HOST required when DATABASE_LOCAL_URL is unset"
		)
	}

	const credentials = awsCredentialsProvider({ roleArn: env.AWS_ROLE_ARN })
	const signer = new Signer({
		region: AWS_REGION,
		hostname: env.DATABASE_HOST,
		port: 5432,
		username: DATABASE_USER,
		credentials
	})

	async function getDbPassword(): Promise<string> {
		const result = await errors.try(signer.getAuthToken())
		if (result.error) {
			logger.error(
				{ error: result.error, host: env.DATABASE_HOST, user: DATABASE_USER },
				"rds iam auth token fetch failed"
			)
			throw errors.wrap(result.error, "rds iam auth token")
		}
		return result.data
	}

	return new Pool({
		host: env.DATABASE_HOST,
		port: 5432,
		user: DATABASE_USER,
		database: DATABASE_NAME,
		ssl: { ca: RDS_CA_BUNDLE, rejectUnauthorized: true },
		max: 10,
		password: getDbPassword
	})
}

function getOrCreatePool(): Pool {
	const cached = globalThis.__18seconds_pg_pool
	if (cached) {
		return cached
	}
	const created = env.DATABASE_LOCAL_URL ? createLocalPool(env.DATABASE_LOCAL_URL) : createRdsPool()
	globalThis.__18seconds_pg_pool = created
	if (!env.DATABASE_LOCAL_URL) {
		attachDatabasePool(created)
	}
	return created
}

const pool = getOrCreatePool()

const db: Db = drizzle({ client: pool, schema: dbSchema })

export type { Db }
export { db }
