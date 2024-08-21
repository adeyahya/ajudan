import { sql } from "drizzle-orm";
import { text, sqliteTable } from "drizzle-orm/sqlite-core";
import { nanoid } from 'nanoid'

export const registries = sqliteTable('registries', {
  id: text('id', {
    length: 6
  }).notNull().primaryKey().$defaultFn(() => nanoid(6)),
  provider: text('provider', { enum: ['ghcr'] }).notNull(),
  registryUrl: text('registry_url').notNull(),
  username: text('username'),
  password: text('password'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`)
});