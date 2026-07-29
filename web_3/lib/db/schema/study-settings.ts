import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const STUDY_SETTING_KEYS = {
  ai33ApiKey: "ai33_api_key",
} as const;

export type StudySettingKey = (typeof STUDY_SETTING_KEYS)[keyof typeof STUDY_SETTING_KEYS];

export const studySettings = pgTable("study_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StudySetting = typeof studySettings.$inferSelect;
