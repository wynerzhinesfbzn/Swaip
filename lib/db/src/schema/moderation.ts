import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const moderationReportsTable = pgTable("moderation_reports", {
  id:            serial("id").primaryKey(),
  reporterHash:  text("reporter_hash"),
  contentType:   text("content_type").notNull(),
  contentId:     text("content_id").notNull(),
  contentText:   text("content_text"),
  category:      text("category"),
  reason:        text("reason"),
  status:        text("status").notNull().default("pending"),
  createdAt:     timestamp("created_at").defaultNow(),
  resolvedAt:    timestamp("resolved_at"),
  resolvedBy:    text("resolved_by"),
});

export const insertModerationReportSchema = createInsertSchema(moderationReportsTable)
  .omit({ id: true, createdAt: true, resolvedAt: true, resolvedBy: true });
export type InsertModerationReport = z.infer<typeof insertModerationReportSchema>;
export type ModerationReport = typeof moderationReportsTable.$inferSelect;

export const moderationLogTable = pgTable("moderation_log", {
  id:            serial("id").primaryKey(),
  userHash:      text("user_hash"),
  contentType:   text("content_type").notNull(),
  contentId:     text("content_id"),
  contentText:   text("content_text"),
  category:      text("category").notNull(),
  matchedRule:   text("matched_rule"),
  action:        text("action").notNull(),
  triggeredBy:   text("triggered_by").notNull().default("auto"),
  createdAt:     timestamp("created_at").defaultNow(),
});

export const moderationBansTable = pgTable("moderation_bans", {
  id:            serial("id").primaryKey(),
  userHash:      text("user_hash").notNull(),
  reason:        text("reason"),
  category:      text("category"),
  bannedAt:      timestamp("banned_at").defaultNow(),
  expiresAt:     timestamp("expires_at"),
  active:        boolean("active").notNull().default(true),
  warningCount:  integer("warning_count").notNull().default(0),
});

export const insertModerationBanSchema = createInsertSchema(moderationBansTable)
  .omit({ id: true, bannedAt: true });
export type InsertModerationBan = z.infer<typeof insertModerationBanSchema>;
export type ModerationBan = typeof moderationBansTable.$inferSelect;
