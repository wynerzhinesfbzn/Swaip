import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { meetingsTable } from "./meetings";

export const meetingParticipantsTable = pgTable("meeting_participants", {
  id:            serial("id").primaryKey(),
  meetingId:     text("meeting_id").notNull().references(() => meetingsTable.meetingId, { onDelete: "cascade" }),
  participantId: text("participant_id").notNull().unique(),
  name:          text("name").notNull(),
  lastName:      text("last_name").notNull(),
  position:      text("position"),
  isAnonymous:   boolean("is_anonymous").default(false),
  role:          text("role").notNull().default("participant"),
  number:        integer("number").default(1),
  joinedAt:      timestamp("joined_at").defaultNow(),
});

export type MeetingParticipant = typeof meetingParticipantsTable.$inferSelect;
