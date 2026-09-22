import { relations } from "drizzle-orm";
import {
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const profileRole = pgEnum("profile_role", ["teacher", "student"]);
export const attendanceStatus = pgEnum("attendance_status", ["present", "late"]);

export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: profileRole("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const classes = pgTable("classes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  code: text("code").notNull().unique(),
  teacherId: integer("teacher_id").notNull().references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const classMembers = pgTable(
  "class_members",
  {
    id: serial("id").primaryKey(),
    classId: integer("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    studentId: integer("student_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("class_member_unique").on(table.classId, table.studentId)],
);

export const lectures = pgTable("lectures", {
  id: serial("id").primaryKey(),
  classId: integer("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  attendanceOpensAt: timestamp("attendance_opens_at", { withTimezone: true }).notNull(),
  attendanceClosesAt: timestamp("attendance_closes_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const attendance = pgTable(
  "attendance",
  {
    id: serial("id").primaryKey(),
    lectureId: integer("lecture_id").notNull().references(() => lectures.id, { onDelete: "cascade" }),
    studentId: integer("student_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    markedAt: timestamp("marked_at", { withTimezone: true }).defaultNow().notNull(),
    status: attendanceStatus("status").notNull(),
  },
  (table) => [unique("attendance_unique").on(table.lectureId, table.studentId)],
);

export const profilesRelations = relations(profiles, ({ many }) => ({
  taughtClasses: many(classes),
  memberships: many(classMembers),
  attendance: many(attendance),
}));

export const classesRelations = relations(classes, ({ one, many }) => ({
  teacher: one(profiles, { fields: [classes.teacherId], references: [profiles.id] }),
  members: many(classMembers),
  lectures: many(lectures),
}));

export const classMembersRelations = relations(classMembers, ({ one }) => ({
  class: one(classes, { fields: [classMembers.classId], references: [classes.id] }),
  student: one(profiles, { fields: [classMembers.studentId], references: [profiles.id] }),
}));

export const lecturesRelations = relations(lectures, ({ one, many }) => ({
  class: one(classes, { fields: [lectures.classId], references: [classes.id] }),
  attendance: many(attendance),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  lecture: one(lectures, { fields: [attendance.lectureId], references: [lectures.id] }),
  student: one(profiles, { fields: [attendance.studentId], references: [profiles.id] }),
}));

export const insertProfileSchema = createInsertSchema(profiles).omit({ id: true, createdAt: true });
export const insertClassSchema = createInsertSchema(classes).omit({ id: true, createdAt: true });
export const insertClassMemberSchema = createInsertSchema(classMembers).omit({ id: true, joinedAt: true });
export const insertLectureSchema = createInsertSchema(lectures).omit({ id: true, createdAt: true });
export const insertAttendanceSchema = createInsertSchema(attendance).omit({ id: true, markedAt: true });

export type Profile = z.infer<typeof insertProfileSchema> & { id: number; createdAt: Date };
export type Class = typeof classes.$inferSelect;
export type ClassMember = typeof classMembers.$inferSelect;
export type Lecture = typeof lectures.$inferSelect;
export type Attendance = typeof attendance.$inferSelect;