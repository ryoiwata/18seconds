// biome-ignore-all lint/style/noProcessEnv: iac env wrapper needs direct process.env access

import * as errors from "@superbuilders/errors"
import { z } from "zod"
import { logger } from "@/logger"

const EnvSchema = z.object({
	AWS_REGION: z.literal("us-east-1").default("us-east-1"),
	VERCEL_TEAM_SLUG: z.string().min(1),
	VERCEL_PROJECT_NAME: z.string().min(1).default("superstarter"),
	ALCHEMY_PASSWORD: z.string().min(32)
})

const parseResult = EnvSchema.safeParse(process.env)
if (!parseResult.success) {
	logger.error({ error: parseResult.error }, "iac env validation failed")
	throw errors.wrap(parseResult.error, "iac env validation")
}

const iacEnv = parseResult.data

export { iacEnv }
