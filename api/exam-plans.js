// /api/exam-plans.js (로직 재구성 최종본)

import { kv } from "@vercel/kv";
import { readSheetObjects } from "../lib/sheets.js";

// --- 날짜 계산 Helper 함수들 ---
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const toUtcDate = (d) => {
  if (!d || typeof d !== "string") return new Date(Date.UTC(1970, 0, 1));
  const [y, m, day] = d.split("T")[0].split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};
const toYMD = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

function countClassDays(start, end, daysSet) {
  let count = 0;
  const startDate = toUtcDate(start);
  const endDate = toUtcDate(end);
  if (startDate > endDate) return 0;
  for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {
    if (daysSet.has(DOW[d.getUTCDay()])) count++;
  }
  return count;
}

function shiftDateByClassDays(start, shift, daysSet) {
  let shifted = toUtcDate(start);
  if (shift === 0) return shifted;
  const dir = shift > 0 ? 1 : -1;
  let counted = 0;
  while (counted < Math.abs(shift)) {
    shifted = addDays(shifted, dir);
    if (daysSet.has(DOW[shifted.getUTCDay()])) counted++;
  }
  return shifted;
}

// --- KV 및 데이터 조회 Helper ---
const isKvReady = () =>
  !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const getExamPlanKey = (s, g) => `exam-plans:${encodeURIComponent(s)}:${g}`;
const getStudentPlanKey = (id) => `plans:${id}`;

async function getStudentAndClassData() {
  return Promise.all([
    readSheetObjects(process.env.STUDENTS_RANGE || "student!A:Z"),
    readSheetObjects(process.env.CLASSES_RANGE || "class!A:Z"),
  ]);
}

/** 학생 한 명의 플랜에서 특정 내신 기간을 제거하고 플랜을 재정렬하는 함수 */
function removeExamSegment(segments, oldExamPlan, studentDaysSet) {
  const examIdToRemove = `seg_exam_${oldExamPlan.id}`;
  if (!segments.some((s) => s.id === examIdToRemove)) {
    return segments; // 제거할 세그먼트가 없으면 원본 반환
  }

  const daysToShiftBack = -Math.abs(
    countClassDays(oldExamPlan.startDate, oldExamPlan.endDate, studentDaysSet)
  );
  const oldExamEndUtc = toUtcDate(oldExamPlan.endDate);

  let cleanSegments = segments.filter((s) => s.id !== examIdToRemove);

  return cleanSegments.map((seg) => {
    if (toUtcDate(seg.startDate) > oldExamEndUtc) {
      const segDaysSet = new Set(
        (seg.days || "").split(",").map((d) => d.trim().toUpperCase())
      );
      const newStart = shiftDateByClassDays(
        seg.startDate,
        daysToShiftBack,
        segDaysSet
      );
      const newEnd = shiftDateByClassDays(
        seg.endDate,
        daysToShiftBack,
        segDaysSet
      );
      return { ...seg, startDate: toYMD(newStart), endDate: toYMD(newEnd) };
    }
    return seg;
  });
}

/** 학생 한 명의 플랜에 내신 기간을 삽입하고 플랜을 재정렬하는 함수 */
function insertExamSegment(segments, newExamPlan, studentDaysSet) {
  const daysToShiftForward = countClassDays(
    newExamPlan.startDate,
    newExamPlan.endDate,
    studentDaysSet
  );
  if (daysToShiftForward <= 0) {
    return [...segments, newExamPlan].sort((a, b) =>
      a.startDate.localeCompare(b.startDate)
    );
  }

  const newExamStartUtc = toUtcDate(newExamPlan.startDate);
  const newExamEndUtc = toUtcDate(newExamPlan.endDate);
  const finalSegments = [];

  for (const seg of segments) {
    const segStartUtc = toUtcDate(seg.startDate);
    const segEndUtc = toUtcDate(seg.endDate);
    const segDaysSet = new Set(
      (seg.days || "").split(",").map((d) => d.trim().toUpperCase())
    );

    if (segEndUtc < newExamStartUtc) {
      finalSegments.push(seg);
      continue;
    }
    if (segStartUtc >= newExamStartUtc) {
      const newStart = shiftDateByClassDays(
        seg.startDate,
        daysToShiftForward,
        segDaysSet
      );
      const newEnd = shiftDateByClassDays(
        seg.endDate,
        daysToShiftForward,
        segDaysSet
      );
      finalSegments.push({
        ...seg,
        startDate: toYMD(newStart),
        endDate: toYMD(newEnd),
      });
      continue;
    }
    if (segStartUtc < newExamStartUtc && segEndUtc >= newExamStartUtc) {
      finalSegments.push({
        ...seg,
        endDate: toYMD(addDays(newExamStartUtc, -1)),
      });

      const partB_Start = addDays(newExamEndUtc, 1);
      const partB_End = shiftDateByClassDays(
        seg.endDate,
        daysToShiftForward,
        segDaysSet
      );

      if (partB_Start <= partB_End) {
        finalSegments.push({
          ...seg,
          startDate: toYMD(partB_Start),
          endDate: toYMD(partB_End),
        });
      }
      continue;
    }
  }
  finalSegments.push(newExamPlan);
  return finalSegments.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

// --- API 핸들러 ---
export default async function handler(req, res) {
  if (!isKvReady())
    return res
      .status(501)
      .json({ ok: false, error: "DB가 설정되지 않았습니다." });

  const { school, grade, examPlanId } = { ...req.body, ...req.query };
  if (req.method !== "GET" && (!school || !grade)) {
    return res
      .status(400)
      .json({ ok: false, error: "school, grade가 필요합니다." });
  }

  try {
    // --- GET (변경 없음) ---
    if (req.method === "GET") {
      const key = getExamPlanKey(school, grade);
      const examPlans = (await kv.get(key)) || [];
      return res.status(200).json({ ok: true, examPlans });
    }

    const [allStudents, allClasses] = await getStudentAndClassData();
    const targetStudents = allStudents.filter(
      (s) => s.school === school && String(s.grade) === String(grade)
    );

    if (req.method !== "GET" && targetStudents.length === 0) {
      return res
        .status(404)
        .json({ ok: false, error: "해당 학생이 없습니다." });
    }

    const examPlanKey = getExamPlanKey(school, grade);
    let examPlans = (await kv.get(examPlanKey)) || [];

    // --- POST (로직 재구성) ---
    if (req.method === "POST") {
      const { planData } = req.body;
      const newExamRecord = { ...planData, id: `exam_${Date.now()}` };

      for (const student of targetStudents) {
        const studentClass = allClasses.find((c) => c.id === student.class_id);
        const studentScheduleDays =
          studentClass?.schedule_days || "MON,WED,FRI";
        const studentDaysSet = new Set(
          studentScheduleDays.split(",").map((s) => s.trim())
        );

        const studentPlanKey = getStudentPlanKey(student.id);
        let studentPlans = (await kv.get(studentPlanKey)) || [];

        const newExamSegment = {
          ...planData,
          id: `seg_exam_${newExamRecord.id}`,
          days: studentScheduleDays,
        };

        if (studentPlans.length === 0) {
          studentPlans.push({
            planId: `pln_${student.id}`,
            studentId: student.id,
            planSegments: [newExamSegment],
            userSkips: {},
          });
        } else {
          studentPlans[0].planSegments = insertExamSegment(
            studentPlans[0].planSegments,
            newExamSegment,
            studentDaysSet
          );
        }
        await kv.set(studentPlanKey, studentPlans);
      }

      examPlans.push(newExamRecord);
      await kv.set(examPlanKey, examPlans);
      return res.status(201).json({ ok: true, newExamPlan: newExamRecord });
    }

    // --- PUT (로직 재구성) ---
    if (req.method === "PUT") {
      const { planData } = req.body;
      const planIndex = examPlans.findIndex((p) => p.id === examPlanId);
      if (planIndex === -1)
        return res
          .status(404)
          .json({ ok: false, error: "수정할 플랜을 찾지 못했습니다." });

      const oldExamRecord = examPlans[planIndex];
      const updatedExamRecord = {
        ...oldExamRecord,
        ...planData,
        updatedAt: new Date().toISOString(),
      };

      for (const student of targetStudents) {
        const studentClass = allClasses.find((c) => c.id === student.class_id);
        const studentScheduleDays =
          studentClass?.schedule_days || "MON,WED,FRI";
        const studentDaysSet = new Set(
          studentScheduleDays.split(",").map((s) => s.trim())
        );

        const studentPlanKey = getStudentPlanKey(student.id);
        let studentPlans = (await kv.get(studentPlanKey)) || [];
        if (studentPlans.length === 0) continue;

        // 1. 기존 내신 기간 제거
        let cleanSegments = removeExamSegment(
          studentPlans[0].planSegments,
          oldExamRecord,
          studentDaysSet
        );

        // 2. 새로운 내신 기간 삽입
        const newExamSegment = {
          ...planData,
          id: `seg_exam_${examPlanId}`,
          days: studentScheduleDays,
        };
        studentPlans[0].planSegments = insertExamSegment(
          cleanSegments,
          newExamSegment,
          studentDaysSet
        );

        await kv.set(studentPlanKey, studentPlans);
      }

      examPlans[planIndex] = updatedExamRecord;
      await kv.set(examPlanKey, examPlans);
      return res
        .status(200)
        .json({ ok: true, updatedExamPlan: updatedExamRecord });
    }

    // --- DELETE (로직 재구성) ---
    if (req.method === "DELETE") {
      const planToDelete = examPlans.find((p) => p.id === examPlanId);
      if (!planToDelete)
        return res
          .status(404)
          .json({ ok: false, error: "삭제할 플랜을 찾지 못했습니다." });

      for (const student of targetStudents) {
        const studentClass = allClasses.find((c) => c.id === student.class_id);
        const studentScheduleDays =
          studentClass?.schedule_days || "MON,WED,FRI";
        const studentDaysSet = new Set(
          studentScheduleDays.split(",").map((s) => s.trim())
        );

        const studentPlanKey = getStudentPlanKey(student.id);
        let studentPlans = (await kv.get(studentPlanKey)) || [];
        if (studentPlans.length === 0) continue;

        studentPlans[0].planSegments = removeExamSegment(
          studentPlans[0].planSegments,
          planToDelete,
          studentDaysSet
        );
        await kv.set(studentPlanKey, studentPlans);
      }

      const updatedExamPlans = examPlans.filter((p) => p.id !== examPlanId);
      await kv.set(examPlanKey, updatedExamPlans);
      return res.status(200).json({ ok: true });
    }
  } catch (e) {
    console.error(`[${req.method}] /api/exam-plans Error:`, e);
    return res.status(500).json({ ok: false, error: e.message });
  }

  res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
  return res
    .status(405)
    .json({ ok: false, error: `Method ${req.method} Not Allowed` });
}
