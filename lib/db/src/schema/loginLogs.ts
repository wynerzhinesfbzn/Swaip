import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const loginLogsTable = pgTable("login_logs", {
  id:        serial("id").primaryKey(),
  userHash:  text("user_hash").notNull(),
  ip:        text("ip").notNull().default("unknown"),
  userAgent: text("user_agent").notNull().default(""),
  success:   boolean("success").notNull().default(true),
  reason:    text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type LoginLog = typeof loginLogsTable.$inferSelect;
