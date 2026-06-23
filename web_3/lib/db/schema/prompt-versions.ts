import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const drPromptVersions = pgTable("dr_prompt_versions", {
  id: serial("id").primaryKey(),
  promptKey: text("prompt_key").notNull(),
  version: integer("version").notNull(),
  template: text("template").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdBy: text("created_by").notNull().default("manual"),
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DrPromptVersion = typeof drPromptVersions.$inferSelect;
