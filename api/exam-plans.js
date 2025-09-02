// /api/exam-plans.js (최종 수정본 - 논리적 병합)

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

// --- 학생별 플랜 조작 함수 (논리적 병합 포함) ---
function processSegmentsAfterDeletion(
  segments,
  oldExamPlan,
  studentScheduleDays
) {
  const examIdToRemove = `seg_exam_${oldExamPlan.id}`;
  const examIndex = segments.findIndex((s) => s.id === examIdToRemove);

  if (examIndex === -1) {
    return segments; // 삭제할 내신 플랜이 없으면 그대로 반환
  }

  const prevSegment = examIndex > 0 ? segments[examIndex - 1] : null;
  const nextSegment =
    examIndex < segments.length - 1 ? segments[examIndex + 1] : null;

  // [핵심] 논리적 병합 시도
  if (prevSegment && nextSegment) {
    const prevLanesId = JSON.stringify(
      Object.values(prevSegment.lanes || {}).flatMap((lane) =>
        (lane || []).map((b) => b.instanceId).sort()
      )
    );
    const nextLanesId = JSON.stringify(
      Object.values(nextSegment.lanes || {}).flatMap((lane) =>
        (lane || []).map((b) => b.instanceId).sort()
      )
    );
    const daysMatch =
      (prevSegment.days || studentScheduleDays) ===
      (nextSegment.days || studentScheduleDays);

    // 두 조각의 교재 구성과 요일 설정이 같으면 병합
    if (prevLanesId === nextLanesId && prevLanesId !== "[]" && daysMatch) {
      const mergedSegment = { ...prevSegment, endDate: nextSegment.endDate };
      const newSegments = [...segments];
      newSegments.splice(examIndex - 1, 3, mergedSegment); // 이전, 내신, 다음 세그먼트를 합쳐진 하나로 교체
      return newSegments;
    }
  }

  // 병합 대상이 아니면, 날짜 이동 방식으로 처리 (내신이 맨 앞/뒤에 있는 경우)
  const studentDaysSet = new Set(
    studentScheduleDays.split(",").map((d) => d.trim().toUpperCase())
  );
  const daysToShiftBack = -Math.abs(
    countClassDays(oldExamPlan.startDate, oldExamPlan.endDate, studentDaysSet)
  );
  const oldExamEndUtc = toUtcDate(oldExamPlan.endDate);

  const cleanSegments = segments.filter((s) => s.id !== examIdToRemove);

  return cleanSegments.map((seg) => {
    if (toUtcDate(seg.startDate) > oldExamEndUtc) {
      const segDaysSet = new Set(
        (seg.days || studentScheduleDays)
          .split(",")
          .map((d) => d.trim().toUpperCase())
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

function insertExamSegment(segments, newExamPlan, studentScheduleDays) {
  const studentDaysSet = new Set(
    studentScheduleDays.split(",").map((d) => d.trim().toUpperCase())
  );
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
      (seg.days || studentScheduleDays)
        .split(",")
        .map((d) => d.trim().toUpperCase())
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
      if (toUtcDate(toYMD(partB_Start)) <= toUtcDate(toYMD(partB_End))) {
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

    for (const student of targetStudents) {
      const studentPlanKey = getStudentPlanKey(student.id);
      let studentPlans = (await kv.get(studentPlanKey)) || [];
      const studentClass = allClasses.find((c) => c.id === student.class_id);
      const classDefaultDays = studentClass?.schedule_days || "MON,WED,FRI";

      const studentScheduleDays =
        studentPlans[0]?.planSegments?.find((seg) => seg.days)?.days ||
        classDefaultDays;

      if (req.method === "POST") {
        const { planData } = req.body;
        const examRecordId = `exam_${Date.now()}`;
        const newExamSegment = {
          ...planData,
          id: `seg_exam_${examRecordId}`,
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
            studentScheduleDays
          );
        }
        await kv.set(studentPlanKey, studentPlans);
      } else if (req.method === "PUT") {
        if (studentPlans.length === 0) continue;
        const { planData } = req.body;
        const planIndex = examPlans.findIndex((p) => p.id === examPlanId);
        if (planIndex === -1) continue;

        const oldExamRecord = examPlans[planIndex];
        let cleanSegments = processSegmentsAfterDeletion(
          studentPlans[0].planSegments,
          oldExamRecord,
          studentScheduleDays
        );

        const newExamSegment = {
          ...planData,
          id: `seg_exam_${examPlanId}`,
          days: studentScheduleDays,
        };
        studentPlans[0].planSegments = insertExamSegment(
          cleanSegments,
          newExamSegment,
          studentScheduleDays
        );

        await kv.set(studentPlanKey, studentPlans);
      } else if (req.method === "DELETE") {
        if (studentPlans.length === 0) continue;
        const planToDelete = examPlans.find((p) => p.id === examPlanId);
        if (!planToDelete) continue;

        studentPlans[0].planSegments = processSegmentsAfterDeletion(
          studentPlans[0].planSegments,
          planToDelete,
          studentScheduleDays
        );
        await kv.set(studentPlanKey, studentPlans);
      }
    }

    // 마스터 내신 플랜 목록 업데이트
    if (req.method === "POST") {
      const { planData } = req.body;
      const examRecordId = `exam_${Date.now()}`;
      examPlans.push({ ...planData, id: examRecordId });
      await kv.set(examPlanKey, examPlans);
      return res
        .status(201)
        .json({ ok: true, newExamPlan: examPlans[examPlans.length - 1] });
    }
    if (req.method === "PUT") {
      const { planData } = req.body;
      const planIndex = examPlans.findIndex((p) => p.id === examPlanId);
      if (planIndex === -1)
        return res
          .status(404)
          .json({ ok: false, error: "수정할 플랜을 찾지 못했습니다." });
      examPlans[planIndex] = {
        ...examPlans[planIndex],
        ...planData,
        updatedAt: new Date().toISOString(),
      };
      await kv.set(examPlanKey, examPlans);
      return res
        .status(200)
        .json({ ok: true, updatedExamPlan: examPlans[planIndex] });
    }
    if (req.method === "DELETE") {
      const initialLength = examPlans.length;
      const updatedExamPlans = examPlans.filter((p) => p.id !== examPlanId);
      if (updatedExamPlans.length === initialLength)
        return res
          .status(404)
          .json({ ok: false, error: "삭제할 플랜을 찾지 못했습니다." });
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
