import { sql } from "drizzle-orm"
import { bigint, index, integer, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { users } from "@/db/schemas/auth/users"
import { items } from "@/db/schemas/catalog/items"

const reviewQueue = pgTable(
	"review_queue",
	{
		id: uuid("id").primaryKey().notNull().default(sql`uuidv7()`),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		itemId: uuid("item_id")
			.notNull()
			.references(() => items.id),
		dueAtMs: bigint("due_at_ms", { mode: "number" }).notNull(),
		intervalDays: integer("interval_days").notNull()
	},
	(table) => [
		index("review_queue_user_due_idx").on(table.userId, table.dueAtMs),
		uniqueIndex("review_queue_user_item_unique").on(table.userId, table.itemId)
	]
)

export { reviewQueue }
