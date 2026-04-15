import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { meetingsTable } from "./meetings";

export const meetingLogsTable = pgTable("meeting_logs", {
  id:                   serial("id").primaryKey(),
  meetingId:            text("meeting_id").notNull().references(() => meetingsTable.meetingId, { onDelete: "cascade" }),
  action:               text("action").notNull(),
  actorParticipantId:   text("actor_participant_id").notNull(),
  targetParticipantId:  text("target_participant_id"),
  details:              text("details"),
  createdAt:            timestamp("created_at").defaultNow(),
});

export type MeetingLog = typeof meetingLogsTable.$inferSelect;
