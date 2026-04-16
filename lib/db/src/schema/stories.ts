import { pgTable, text, integer, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const storiesTable = pgTable("stories", {
  id:          serial("id").primaryKey(),
  authorHash:  text("author_hash").notNull(),
  authorMode:  text("author_mode").notNull().default("pro"),
  mediaType:   text("media_type").notNull(),
  mediaUrl:    text("media_url"),
  textContent: text("text_content"),
  bgGradient:  text("bg_gradient"),
  expiresAt:   timestamp("expires_at").notNull(),
  createdAt:   timestamp("created_at").defaultNow(),
  viewCount:   integer("view_count").default(0),
});

export const insertStorySchema = createInsertSchema(storiesTable).omit({ id: true, createdAt: true, viewCount: true });
export type InsertStory = z.infer<typeof insertStorySchema>;
export type Story = typeof storiesTable.$inferSelect;
