import {
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const workerStatusEnum = pgEnum("worker_status", ["running", "stopped"]);

/**
 * Generic key/value settings table (one row per setting; multi-channel not in
 * scope). Two purpose-built column groups ride alongside the generic key/value
 * pair on dedicated rows:
 *   - worker_heartbeat row: worker_last_seen_at / worker_last_status — drives
 *     the "stopped mid-run" alert (fire only when status='running' AND
 *     now() - last_seen > 30 min).
 * Everything else (score thresholds, rollback counters/window, batch sizes,
 * pause flags) is plain key/value — see lib/db/repo/channel-config.ts and the
 * rollback-window helpers in app/api/cron/evaluate-rollback/route.ts.
 */
export const channelConfig = pgTable("channel_config", {
  key: text("key").primaryKey(),
  value: text("value"),
  workerLastSeenAt: timestamp("worker_last_seen_at", { withTimezone: true }),
  workerLastStatus: workerStatusEnum("worker_last_status"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
