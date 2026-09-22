import { Router, type NextFunction, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  attendance,
  classMembers,
  classes,
  lectures,
  profiles,
} from "@workspace/db/schema";
import {
  CreateClassBody,
  CreateLectureBody,
  CreateLectureParams,
  GetClassParams,
  GetLectureAttendanceParams,
  JoinClassBody,
  MarkAttendanceParams,
  UpsertMeBody,
} from "@workspace/api-zod";

type AuthenticatedRequest = Request & { userId: string; profile?: typeof profiles.$inferSelect };

const router = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  const userId = auth?.userId ?? (auth?.sessionClaims as unknown as { userId?: string } | undefined)?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthenticatedRequest).userId = userId;
  next();
}

async function currentProfile(req: AuthenticatedRequest) {
  if (req.profile) return req.profile;
  const [profile] = await db.select().from(profiles).where(eq(profiles.clerkUserId, req.userId)).limit(1);
  req.profile = profile;
  return profile;
}

function profileOrFail(req: AuthenticatedRequest, res: Response) {
  if (!req.profile) {
    res.status(409).json({ error: "Complete your profile before continuing." });
    return null;
  }
  return req.profile;
}

function lectureStatus(lecture: typeof lectures.$inferSelect) {
  const now = Date.now();
  if (now < lecture.attendanceOpensAt.getTime()) return "upcoming" as const;
  if (now <= lecture.attendanceClosesAt.getTime()) return "live" as const;
  return "closed" as const;
}

function iso(value: Date) {
  return value.toISOString();
}

function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function classForUser(classId: number, profile: typeof profiles.$inferSelect) {
  const [classRow] = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
  if (!classRow) return null;
  if (profile.role === "teacher" && classRow.teacherId === profile.id) return classRow;
  if (profile.role === "student") {
    const [membership] = await db.select().from(classMembers).where(and(eq(classMembers.classId, classId), eq(classMembers.studentId, profile.id))).limit(1);
    if (membership) return classRow;
  }
  return null;
}

async function lectureView(lecture: typeof lectures.$inferSelect, profile: typeof profiles.$inferSelect) {
  const [counts] = await db
    .select({ attendanceCount: count(attendance.id) })
    .from(attendance)
    .where(eq(attendance.lectureId, lecture.id));
  const [students] = await db
    .select({ totalStudents: count(classMembers.id) })
    .from(classMembers)
    .where(eq(classMembers.classId, lecture.classId));
  let marked = false;
  if (profile.role === "student") {
    const [record] = await db.select({ id: attendance.id }).from(attendance).where(and(eq(attendance.lectureId, lecture.id), eq(attendance.studentId, profile.id))).limit(1);
    marked = Boolean(record);
  }
  return {
    id: lecture.id,
    classId: lecture.classId,
    title: lecture.title,
    startsAt: iso(lecture.startsAt),
    endsAt: iso(lecture.endsAt),
    attendanceOpensAt: iso(lecture.attendanceOpensAt),
    attendanceClosesAt: iso(lecture.attendanceClosesAt),
    attendanceCount: Number(counts?.attendanceCount ?? 0),
    totalStudents: Number(students?.totalStudents ?? 0),
    attendanceMarked: marked,
    status: lectureStatus(lecture),
  };
}

async function classView(classRow: typeof classes.$inferSelect) {
  const [teacher] = await db.select({ name: profiles.name }).from(profiles).where(eq(profiles.id, classRow.teacherId)).limit(1);
  const [studentCounts] = await db.select({ count: count(classMembers.id) }).from(classMembers).where(eq(classMembers.classId, classRow.id));
  const [upcomingCounts] = await db.select({ count: count(lectures.id) }).from(lectures).where(and(eq(lectures.classId, classRow.id), sql`${lectures.attendanceClosesAt} >= now()`));
  return {
    id: classRow.id,
    name: classRow.name,
    code: classRow.code,
    subject: classRow.subject,
    teacherName: teacher?.name ?? "Teacher",
    studentCount: Number(studentCounts?.count ?? 0),
    upcomingLectureCount: Number(upcomingCounts?.count ?? 0),
    createdAt: iso(classRow.createdAt),
  };
}

router.get("/me", requireAuth, async (req, res) => {
  const profile = await currentProfile(req as AuthenticatedRequest);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json({ ...profile, createdAt: iso(profile.createdAt) });
});

router.put("/me", requireAuth, async (req, res) => {
  const parsed = UpsertMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid profile", details: parsed.error.flatten() });
    return;
  }
  const authReq = req as AuthenticatedRequest;
  const existing = await currentProfile(authReq);
  const [profile] = existing
    ? await db.update(profiles).set(parsed.data).where(eq(profiles.id, existing.id)).returning()
    : await db.insert(profiles).values({ clerkUserId: authReq.userId, ...parsed.data }).returning();
  res.json({ ...profile, createdAt: iso(profile.createdAt) });
});

router.get("/dashboard/summary", requireAuth, async (req, res) => {
  const profile = await currentProfile(req as AuthenticatedRequest);
  if (!profile) {
    res.status(409).json({ error: "Complete your profile before continuing." });
    return;
  }
  const userClasses = profile.role === "teacher"
    ? await db.select().from(classes).where(eq(classes.teacherId, profile.id))
    : await db.select({ classRow: classes }).from(classes).innerJoin(classMembers, eq(classMembers.classId, classes.id)).where(eq(classMembers.studentId, profile.id)).then((rows) => rows.map((row) => row.classRow));
  const classIds = userClasses.map((item) => item.id);
  const userLectures = classIds.length ? await db.select().from(lectures).where(inArray(lectures.classId, classIds)).orderBy(asc(lectures.startsAt)) : [];
  const recent = await Promise.all(userLectures.slice(-5).reverse().map((lecture) => lectureView(lecture, profile)));
  const records = profile.role === "student" && userLectures.length
    ? await db.select().from(attendance).where(and(eq(attendance.studentId, profile.id), inArray(attendance.lectureId, userLectures.map((item) => item.id))))
    : [];
  const liveOrUpcoming = userLectures.filter((item) => item.attendanceClosesAt.getTime() >= Date.now()).length;
  const teacherSlotCounts = profile.role === "teacher"
    ? await Promise.all(userLectures.map((lecture) => db.select({ count: count(classMembers.id) }).from(classMembers).where(eq(classMembers.classId, lecture.classId))))
    : [];
  const totalSlots = profile.role === "teacher"
    ? teacherSlotCounts.reduce((sum, rows) => sum + Number(rows[0]?.count ?? 0), 0)
    : userLectures.length;
  const attended = profile.role === "teacher"
    ? Number((await db.select({ count: count(attendance.id) }).from(attendance).where(inArray(attendance.lectureId, userLectures.map((item) => item.id))))[0]?.count ?? 0)
    : records.length;
  const lateCount = profile.role === "student" ? records.filter((record) => record.status === "late").length : 0;
  res.json({
    role: profile.role,
    totalClasses: userClasses.length,
    totalLectures: userLectures.length,
    attendanceRate: totalSlots ? Math.round((attended / totalSlots) * 100) : 0,
    upcomingLectures: liveOrUpcoming,
    presentCount: profile.role === "student" ? records.filter((record) => record.status === "present").length : attended - lateCount,
    lateCount,
    recentLectures: recent,
  });
});

router.get("/classes", requireAuth, async (req, res) => {
  const profile = await currentProfile(req as AuthenticatedRequest);
  if (!profile) {
    res.status(409).json({ error: "Complete your profile before continuing." });
    return;
  }
  const rows = profile.role === "teacher"
    ? await db.select().from(classes).where(eq(classes.teacherId, profile.id)).orderBy(desc(classes.createdAt))
    : await db.select({ classRow: classes }).from(classes).innerJoin(classMembers, eq(classMembers.classId, classes.id)).where(eq(classMembers.studentId, profile.id)).orderBy(desc(classes.createdAt)).then((items) => items.map((item) => item.classRow));
  res.json(await Promise.all(rows.map(classView)));
});

router.post("/classes", requireAuth, async (req, res) => {
  const parsed = CreateClassBody.safeParse(req.body);
  const profile = await currentProfile(req as AuthenticatedRequest);
  if (!profile || profile.role !== "teacher") {
    res.status(403).json({ error: "Only teachers can create classes." });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid class", details: parsed.error.flatten() });
    return;
  }
  let code = makeCode();
  while ((await db.select({ id: classes.id }).from(classes).where(eq(classes.code, code)).limit(1)).length) code = makeCode();
  const [created] = await db.insert(classes).values({ ...parsed.data, code, teacherId: profile.id }).returning();
  res.status(201).json(await classView(created));
});

router.post("/classes/join", requireAuth, async (req, res) => {
  const parsed = JoinClassBody.safeParse(req.body);
  const profile = await currentProfile(req as AuthenticatedRequest);
  if (!profile || profile.role !== "student") {
    res.status(403).json({ error: "Only students can join classes." });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid class code", details: parsed.error.flatten() });
    return;
  }
  const [classRow] = await db.select().from(classes).where(eq(classes.code, parsed.data.code.toUpperCase())).limit(1);
  if (!classRow) {
    res.status(404).json({ error: "Class code not found." });
    return;
  }
  await db.insert(classMembers).values({ classId: classRow.id, studentId: profile.id }).onConflictDoNothing();
  res.json(await classView(classRow));
});

router.get("/classes/:classId", requireAuth, async (req, res) => {
  const profile = await currentProfile(req as AuthenticatedRequest);
  const parsed = GetClassParams.safeParse(req.params);
  if (!profile || !parsed.success) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const classRow = await classForUser(parsed.data.classId, profile);
  if (!classRow) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const classInfo = await classView(classRow);
  const classLectures = await db.select().from(lectures).where(eq(lectures.classId, classRow.id)).orderBy(desc(lectures.startsAt));
  res.json({ ...classInfo, lectures: await Promise.all(classLectures.map((lecture) => lectureView(lecture, profile))) });
});

router.get("/classes/:classId/lectures", requireAuth, async (req, res) => {
  const profile = await currentProfile(req as AuthenticatedRequest);
  const parsed = GetClassParams.safeParse(req.params);
  if (!profile || !parsed.success || !(await classForUser(parsed.data.classId, profile))) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const rows = await db.select().from(lectures).where(eq(lectures.classId, parsed.data.classId)).orderBy(desc(lectures.startsAt));
  res.json(await Promise.all(rows.map((lecture) => lectureView(lecture, profile))));
});

router.post("/classes/:classId/lectures", requireAuth, async (req, res) => {
  const profile = await currentProfile(req as AuthenticatedRequest);
  const params = CreateLectureParams.safeParse(req.params);
  const body = CreateLectureBody.safeParse(req.body);
  if (!profile || profile.role !== "teacher" || !params.success) {
    res.status(403).json({ error: "Only the class teacher can create lectures." });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: "Invalid lecture", details: body.error.flatten() });
    return;
  }
  const classRow = await classForUser(params.data.classId, profile);
  if (!classRow) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const values = {
    classId: params.data.classId,
    title: body.data.title,
    startsAt: new Date(body.data.startsAt),
    endsAt: new Date(body.data.endsAt),
    attendanceOpensAt: new Date(body.data.attendanceOpensAt),
    attendanceClosesAt: new Date(body.data.attendanceClosesAt),
  };
  if (values.endsAt <= values.startsAt || values.attendanceOpensAt > values.attendanceClosesAt) {
    res.status(400).json({ error: "Lecture and attendance window times are invalid." });
    return;
  }
  const [created] = await db.insert(lectures).values(values).returning();
  res.status(201).json(await lectureView(created, profile));
});

router.get("/lectures/:lectureId/attendance", requireAuth, async (req, res) => {
  const profile = await currentProfile(req as AuthenticatedRequest);
  const parsed = GetLectureAttendanceParams.safeParse(req.params);
  if (!profile || !parsed.success) {
    res.status(404).json({ error: "Lecture not found." });
    return;
  }
  const [lecture] = await db.select().from(lectures).where(eq(lectures.id, parsed.data.lectureId)).limit(1);
  if (!lecture || !(await classForUser(lecture.classId, profile))) {
    res.status(404).json({ error: "Lecture not found." });
    return;
  }
  if (profile.role === "student") {
    const rows = await db.select().from(attendance).where(and(eq(attendance.lectureId, lecture.id), eq(attendance.studentId, profile.id)));
    res.json(rows.map((record) => ({
      id: record.id,
      lectureId: record.lectureId,
      studentName: profile.name,
      studentEmail: profile.email,
      markedAt: iso(record.markedAt),
      status: record.status,
    })));
    return;
  }
  const rows = await db.select({ record: attendance, student: profiles }).from(attendance).innerJoin(profiles, eq(profiles.id, attendance.studentId)).where(eq(attendance.lectureId, lecture.id)).orderBy(asc(attendance.markedAt));
  res.json(rows.map(({ record, student }) => ({
    id: record.id,
    lectureId: record.lectureId,
    studentName: student.name,
    studentEmail: student.email,
    markedAt: iso(record.markedAt),
    status: record.status,
  })));
});

router.post("/lectures/:lectureId/attendance", requireAuth, async (req, res) => {
  const profile = await currentProfile(req as AuthenticatedRequest);
  const parsed = MarkAttendanceParams.safeParse(req.params);
  if (!profile || profile.role !== "student" || !parsed.success) {
    res.status(403).json({ error: "Only students can mark attendance." });
    return;
  }
  const [lecture] = await db.select().from(lectures).where(eq(lectures.id, parsed.data.lectureId)).limit(1);
  if (!lecture || !(await classForUser(lecture.classId, profile))) {
    res.status(404).json({ error: "Lecture not found." });
    return;
  }
  const now = new Date();
  if (now < lecture.attendanceOpensAt || now > lecture.attendanceClosesAt) {
    res.status(400).json({ error: "Attendance is not currently open for this lecture." });
    return;
  }
  const status = now > lecture.startsAt ? "late" : "present";
  const [record] = await db.insert(attendance).values({ lectureId: lecture.id, studentId: profile.id, status }).onConflictDoUpdate({ target: [attendance.lectureId, attendance.studentId], set: { markedAt: now, status } }).returning();
  res.status(201).json({ id: record.id, lectureId: record.lectureId, studentName: profile.name, studentEmail: profile.email, markedAt: iso(record.markedAt), status: record.status });
});

export default router;