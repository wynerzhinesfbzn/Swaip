import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reviewsTable = pgTable("reviews", {
  id:           serial("id").primaryKey(),
  targetHash:   text("target_hash").notNull(),
  authorHash:   text("author_hash").notNull(),
  authorName:   text("author_name").notNull(),
  rating:       integer("rating").notNull().default(5),
  text:         text("text").notNull(),
  createdAt:    timestamp("created_at").defaultNow(),
}, (table) => ({
  onePerAuthorPerTarget: unique("one_review_per_author_target").on(table.targetHash, table.authorHash),
}));

export const insertReviewSchema = createInsertSchema(reviewsTable)
  .omit({ id: true, createdAt: true });

export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviewsTable.$inferSelect;
