import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { meetingsTable } from "./meetings";
import { meetingParticipantsTable } from "./meetingParticipants";

export const meetingMessagesTable = pgTable("meeting_messages", {
  id:            serial("id").primaryKey(),
  meetingId:     text("meeting_id").notNull().references(() => meetingsTable.meetingId, { onDelete: "cascade" }),
  participantId: text("participant_id").notNull(),
  senderName:    text("sender_name").notNull(),
  type:          text("type").notNull().default("text"),
  content:       text("content"),
  fileUrl:       text("file_url"),
  fileName:      text("file_name"),
  fileSize:      integer("file_size"),
  createdAt:     timestamp("created_at").defaultNow(),
});

export type MeetingMessage = typeof meetingMessagesTable.$inferSelect;
