import { sql } from "drizzle-orm"
import { boolean, index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core"

const coreTodos = pgTable(
	"core_todos",
	{
		id: uuid("id").defaultRandom().notNull().primaryKey(),
		title: varchar("title", { length: 256 }).notNull(),
		completed: boolean("completed").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(function now() {
			return new Date()
		})
	},
	(table) => [
		index("core_todos_completed_idx").on(table.completed),
		index("core_todos_created_at_idx").on(table.createdAt)
	]
)

export { coreTodos }
