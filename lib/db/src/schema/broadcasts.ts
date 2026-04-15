import { pgTable, text, integer, serial, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const broadcastsTable = pgTable("broadcasts", {
  id:         serial("id").primaryKey(),
  authorHash: text("author_hash").notNull(),
  authorMode: text("author_mode").notNull(),
  content:    text("content").notNull(),
  audioUrl:   text("audio_url"),
  imageUrl:   text("image_url"),
  videoUrl:   text("video_url"),
  docUrls:    text("doc_urls"),
  createdAt:  timestamp("created_at").defaultNow(),
  viewCount:  integer("view_count").default(0),
});

export const broadcastReactionsTable = pgTable("broadcast_reactions", {
  id:          serial("id").primaryKey(),
  broadcastId: integer("broadcast_id").notNull(),
  userHash:    text("user_hash").notNull(),
  emoji:       text("emoji").notNull(),
}, (t) => [unique().on(t.broadcastId, t.userHash, t.emoji)]);

export const broadcastCommentsTable = pgTable("broadcast_comments", {
  id:          serial("id").primaryKey(),
  broadcastId: integer("broadcast_id").notNull(),
  authorHash:  text("author_hash").notNull(),
  content:     text("content").notNull(),
  audioUrl:    text("audio_url"),
  createdAt:   timestamp("created_at").defaultNow(),
  parentId:    integer("parent_id"),
});

export const commentReactionsTable = pgTable("comment_reactions", {
  id:        serial("id").primaryKey(),
  commentId: integer("comment_id").notNull(),
  userHash:  text("user_hash").notNull(),
  emoji:     text("emoji").notNull(),
}, (t) => [unique().on(t.commentId, t.userHash, t.emoji)]);

export const insertBroadcastSchema = createInsertSchema(broadcastsTable).omit({ id: true, createdAt: true, viewCount: true });
export type InsertBroadcast = z.infer<typeof insertBroadcastSchema>;
export type Broadcast = typeof broadcastsTable.$inferSelect;
