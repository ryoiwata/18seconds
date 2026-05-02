import { sql } from "drizzle-orm"
import { bigint, index, pgTable, uuid } from "drizzle-orm/pg-core"
import { users } from "@/db/schemas/auth/users"
import { strategies } from "@/db/schemas/catalog/strategies"

const strategyViews = pgTable(
	"strategy_views",
	{
		id: uuid("id").primaryKey().notNull().default(sql`uuidv7()`),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		strategyId: uuid("strategy_id")
			.notNull()
			.references(() => strategies.id, { onDelete: "cascade" }),
		viewedAtMs: bigint("viewed_at_ms", { mode: "number" }).notNull()
	},
	(table) => [index("strategy_views_user_strategy_idx").on(table.userId, table.strategyId)]
)

export { strategyViews }
