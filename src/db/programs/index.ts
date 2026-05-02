import type { SQL } from "drizzle-orm"
import { pgcrypto } from "@/db/programs/extensions/pgcrypto"
import { pgvector } from "@/db/programs/extensions/pgvector"
import {
	createAppUser,
	grantAllSequencesToAppUser,
	grantAllTablesToAppUser,
	grantConnectToAppUser,
	grantDefaultSequencePrivsToAppUser,
	grantDefaultTablePrivsToAppUser,
	grantRdsIamToAppUser,
	grantSchemaUsageToAppUser
} from "@/db/programs/grants/app-user"

const programs: SQL[] = [
	createAppUser(),
	grantRdsIamToAppUser(),
	grantConnectToAppUser(),
	pgcrypto(),
	pgvector(),
	grantSchemaUsageToAppUser(),
	grantAllTablesToAppUser(),
	grantAllSequencesToAppUser(),
	grantDefaultTablePrivsToAppUser(),
	grantDefaultSequencePrivsToAppUser()
]

export { programs }
