import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const meetingsTable = pgTable("meetings", {
  id:                  serial("id").primaryKey(),
  meetingId:           text("meeting_id").notNull().unique(),
  creatorHash:         text("creator_hash").notNull(),
  name:                text("name").notNull(),
  startTime:           integer("start_time"),
  tokenType:           text("token_type").notNull().default("common"),
  commonToken:         text("common_token"),
  codeWord:            text("code_word"),
  tokenExpiry:         integer("token_expiry"),
  allowAnonymous:      boolean("allow_anonymous").default(false),
  anonymousToken:      text("anonymous_token"),
  whiteboardSnapshot:  text("whiteboard_snapshot"),
  createdAt:           timestamp("created_at").defaultNow(),
});

export const insertMeetingSchema = createInsertSchema(meetingsTable)
  .omit({ id: true, createdAt: true });

export type InsertMeeting = z.infer<typeof insertMeetingSchema>;
export type Meeting = typeof meetingsTable.$inferSelect;
