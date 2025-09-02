// /api/exam-plans.js

import { kv } from "@vercel/kv";
import { readSheetObjects } from "../lib/sheets.js";

// --- 날짜 계산을 위한 Helper 함수들 (변경 없음) ---
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const toUtcDate = (dateString) => {
  if (!dateString || typeof dateString !== "string") {
    return new Date(Date.UTC(1970, 0, 1));
  }
  const parts = dateString.split("T")[0].split("-");
  if (parts.length !== 3) {
    return new Date(Date.UTC(1970, 0, 1));
  }
  const [year, month, day] = parts.map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};
const toYMD = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

function countClassDays(startDate, endDate, classDaysSet) {
  let count = 0;
  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  if (start > end) return 0;
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    if (classDaysSet.has(DOW[d.getUTCDay()])) {
      count++;
    }
  }
  return count;
}

function shiftDateByClassDays(startDate, daysToShift, classDaysSet) {
  let shiftedDate = toUtcDate(startDate);
  if (daysToShift === 0) return shiftedDate;
  const direction = daysToShift > 0 ? 1 : -1;
  let daysCounted = 0;
  while (daysCounted < Math.abs(daysToShift)) {
    shiftedDate = addDays(shiftedDate, direction);
    if (classDaysSet.has(DOW[shiftedDate.getUTCDay()])) {
      daysCounted++;
    }
  }
  return shiftedDate;
}

// --- KV 저장을 위한 Helper 함수들 (변경 없음) ---
function isKvReady() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}
function getExamPlanKey(school, grade) {
  return `exam-plans:${encodeURIComponent(school)}:${grade}`;
}
function getStudentPlanKey(studentId) {
  return `plans:${studentId}`;
}

// --- 학생 및 반 정보 조회 함수 ---
async function getStudentAndClassData() {
  const [allStudents, allClasses] = await Promise.all([
    readSheetObjects(process.env.STUDENTS_RANGE || "student!A:Z"),
    readSheetObjects(process.env.CLASSES_RANGE || "class!A:Z"),
  ]);
  return { allStudents, allClasses };
}

// --- 메인 API 핸들러 ---
export default async function handler(req, res) {
  if (!isKvReady()) {
    return res
      .status(501)
      .json({ ok: false, error: "KV 데이터베이스가 설정되지 않았습니다." });
  }

  // --- GET: 내신 플랜 목록 조회 (변경 없음) ---
  if (req.method === "GET") {
    const { school, grade } = req.query;
    if (!school || !grade) {
      return res
        .status(400)
        .json({ ok: false, error: "school and grade가 필요합니다." });
    }
    try {
      const key = getExamPlanKey(school, grade);
      const examPlans = (await kv.get(key)) || [];
      return res.status(200).json({ ok: true, examPlans });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- POST: 새 내신 플랜 생성 및 학생 플랜에 적용 ---
  if (req.method === "POST") {
    try {
      const { school, grade, planData } = req.body;
      if (!school || !grade || !planData) {
        return res
          .status(400)
          .json({ ok: false, error: "school, grade, planData가 필요합니다." });
      }

      const { allStudents, allClasses } = await getStudentAndClassData();
      const targetStudents = allStudents.filter(
        (s) => s.school === school && String(s.grade) === String(grade)
      );

      if (targetStudents.length === 0) {
        return res
          .status(404)
          .json({ ok: false, error: "해당하는 학생을 찾을 수 없습니다." });
      }

      const newExamPlanForRecord = {
        ...planData,
        id: `exam_${Date.now()}`,
        createdAt: new Date().toISOString(),
      };

      for (const student of targetStudents) {
        const studentClass = allClasses.find((c) => c.id === student.class_id);
        const studentScheduleDays =
          studentClass?.schedule_days || "MON,WED,FRI";
        const studentClassDaysSet = new Set(
          studentScheduleDays.split(",").map((s) => s.trim().toUpperCase())
        );

        const studentPlanKey = getStudentPlanKey(student.id);
        let studentPlans = (await kv.get(studentPlanKey)) || [];

        const examSegmentData = {
          title: planData.title,
          startDate: planData.startDate,
          endDate: planData.endDate,
          lanes: planData.lanes,
          days: studentScheduleDays, // [핵심] 학생의 개별 요일 적용
        };

        if (studentPlans.length === 0) {
          studentPlans.push({
            planId: `pln_exam_${student.id}_${newExamPlanForRecord.id}`,
            studentId: student.id,
            planSegments: [
              { id: `seg_exam_${newExamPlanForRecord.id}`, ...examSegmentData },
            ],
            userSkips: {},
          });
          await kv.set(studentPlanKey, studentPlans);
          continue;
        }

        const planToModify = studentPlans[0];
        const originalSegments = planToModify.planSegments;
        const newSegments = [];
        const examStartDateUtc = toUtcDate(examSegmentData.startDate);
        const examEndDateUtc = toUtcDate(examSegmentData.endDate);

        const daysToShift = countClassDays(
          examSegmentData.startDate,
          examSegmentData.endDate,
          studentClassDaysSet
        );
        if (daysToShift <= 0) continue;

        for (const segment of originalSegments) {
          const segmentStartUtc = toUtcDate(segment.startDate);
          const segmentEndUtc = toUtcDate(segment.endDate);

          if (segmentEndUtc < examStartDateUtc) {
            newSegments.push(segment);
            continue;
          }

          if (segmentStartUtc >= examStartDateUtc) {
            const segmentDaysSet = new Set(
              (segment.days || studentScheduleDays)
                .split(",")
                .map((s) => s.trim().toUpperCase())
            );
            const shiftedStart = shiftDateByClassDays(
              segment.startDate,
              daysToShift,
              segmentDaysSet
            );
            const shiftedEnd = shiftDateByClassDays(
              segment.endDate,
              daysToShift,
              segmentDaysSet
            );
            newSegments.push({
              ...segment,
              startDate: toYMD(shiftedStart),
              endDate: toYMD(shiftedEnd),
            });
            continue;
          }

          if (
            segmentStartUtc < examStartDateUtc &&
            segmentEndUtc >= examStartDateUtc
          ) {
            newSegments.push({
              ...segment,
              endDate: toYMD(addDays(examStartDateUtc, -1)),
            });

            const segmentDaysSet = new Set(
              (segment.days || studentScheduleDays)
                .split(",")
                .map((s) => s.trim().toUpperCase())
            );
            const shiftedEnd = shiftDateByClassDays(
              segment.endDate,
              daysToShift,
              segmentDaysSet
            );

            // [수정] 분할된 뒷부분의 시작 날짜를 내신 종료일 바로 다음날부터 다시 계산
            const partBStartDate = addDays(examEndDateUtc, 1);
            newSegments.push({
              ...segment,
              startDate: toYMD(partBStartDate),
              endDate: toYMD(shiftedEnd),
            });
            continue;
          }
        }

        newSegments.push({
          id: `seg_exam_${newExamPlanForRecord.id}`,
          ...examSegmentData,
        });
        planToModify.planSegments = newSegments.sort((a, b) =>
          a.startDate.localeCompare(b.startDate)
        );
        await kv.set(studentPlanKey, studentPlans);
      }

      const examPlanKey = getExamPlanKey(school, grade);
      let examPlans = (await kv.get(examPlanKey)) || [];
      examPlans.push(newExamPlanForRecord);
      await kv.set(examPlanKey, examPlans);

      return res
        .status(201)
        .json({ ok: true, newExamPlan: newExamPlanForRecord });
    } catch (e) {
      console.error("내신 플랜 생성 실패:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- PUT: 기존 내신 플랜 수정 및 모든 학생 플랜에 반영 (변경 없음) ---
  if (req.method === "PUT") {
    try {
      const { school, grade, examPlanId, planData } = req.body;
      if (!school || !grade || !examPlanId || !planData) {
        return res
          .status(400)
          .json({
            ok: false,
            error: "school, grade, examPlanId, planData가 필요합니다.",
          });
      }

      const examPlanKey = getExamPlanKey(school, grade);
      let examPlans = (await kv.get(examPlanKey)) || [];
      const planIndex = examPlans.findIndex((p) => p.id === examPlanId);
      if (planIndex === -1) {
        return res
          .status(404)
          .json({ ok: false, error: "수정할 내신 플랜을 찾지 못했습니다." });
      }

      const oldPlanData = examPlans[planIndex];
      const updatedPlanData = {
        ...oldPlanData,
        ...planData,
        updatedAt: new Date().toISOString(),
      };
      examPlans[planIndex] = updatedPlanData;

      const { allStudents, allClasses } = await getStudentAndClassData();
      const targetStudents = allStudents.filter(
        (s) => s.school === school && String(s.grade) === String(grade)
      );

      for (const student of targetStudents) {
        const studentClass = allClasses.find((c) => c.id === student.class_id);
        const studentScheduleDays =
          studentClass?.schedule_days || "MON,WED,FRI";
        const studentClassDaysSet = new Set(
          studentScheduleDays.split(",").map((s) => s.trim().toUpperCase())
        );

        const studentPlanKey = getStudentPlanKey(student.id);
        let studentPlans = (await kv.get(studentPlanKey)) || [];
        if (studentPlans.length === 0) continue;

        const planToModify = studentPlans[0];
        let segments = planToModify.planSegments;

        const oldDaysCount = countClassDays(
          oldPlanData.startDate,
          oldPlanData.endDate,
          studentClassDaysSet
        );
        const oldExamSegmentId = `seg_exam_${examPlanId}`;
        segments = segments.filter((s) => s.id !== oldExamSegmentId);

        segments = segments.map((segment) => {
          const segmentDaysSet = new Set(
            (segment.days || studentScheduleDays)
              .split(",")
              .map((s) => s.trim().toUpperCase())
          );
          if (toUtcDate(segment.startDate) > toUtcDate(oldPlanData.endDate)) {
            const newStart = shiftDateByClassDays(
              segment.startDate,
              -oldDaysCount,
              segmentDaysSet
            );
            const newEnd = shiftDateByClassDays(
              segment.endDate,
              -oldDaysCount,
              segmentDaysSet
            );
            return {
              ...segment,
              startDate: toYMD(newStart),
              endDate: toYMD(newEnd),
            };
          }
          return segment;
        });

        const newDaysCount = countClassDays(
          updatedPlanData.startDate,
          updatedPlanData.endDate,
          studentClassDaysSet
        );
        const newExamSegment = {
          id: oldExamSegmentId,
          ...updatedPlanData,
          days: studentScheduleDays,
        };
        const newExamStartUtc = toUtcDate(updatedPlanData.startDate);
        const newExamEndUtc = toUtcDate(updatedPlanData.endDate);

        let finalSegments = [];
        for (const segment of segments) {
          const segmentStartUtc = toUtcDate(segment.startDate);
          const segmentEndUtc = toUtcDate(segment.endDate);
          const segmentDaysSet = new Set(
            (segment.days || studentScheduleDays)
              .split(",")
              .map((s) => s.trim().toUpperCase())
          );

          if (segmentEndUtc < newExamStartUtc) {
            finalSegments.push(segment);
            continue;
          }
          if (segmentStartUtc >= newExamStartUtc) {
            const shiftedStart = shiftDateByClassDays(
              segment.startDate,
              newDaysCount,
              segmentDaysSet
            );
            const shiftedEnd = shiftDateByClassDays(
              segment.endDate,
              newDaysCount,
              segmentDaysSet
            );
            finalSegments.push({
              ...segment,
              startDate: toYMD(shiftedStart),
              endDate: toYMD(shiftedEnd),
            });
            continue;
          }
          if (
            segmentStartUtc < newExamStartUtc &&
            segmentEndUtc >= newExamStartUtc
          ) {
            finalSegments.push({
              ...segment,
              endDate: toYMD(addDays(newExamStartUtc, -1)),
            });

            const shiftedEnd = shiftDateByClassDays(
              segment.endDate,
              newDaysCount,
              segmentDaysSet
            );
            const partBStartDate = addDays(newExamEndUtc, 1);
            finalSegments.push({
              ...segment,
              startDate: toYMD(partBStartDate),
              endDate: toYMD(shiftedEnd),
            });
            continue;
          }
        }

        finalSegments.push(newExamSegment);
        planToModify.planSegments = finalSegments.sort((a, b) =>
          a.startDate.localeCompare(b.startDate)
        );
        await kv.set(studentPlanKey, studentPlans);
      }

      await kv.set(examPlanKey, examPlans);
      return res
        .status(200)
        .json({ ok: true, updatedExamPlan: updatedPlanData });
    } catch (e) {
      console.error("내신 플랜 수정 실패:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- DELETE: 내신 플랜 삭제 및 모든 학생 플랜에서 제거/조정 (변경 없음) ---
  if (req.method === "DELETE") {
    try {
      const { school, grade, examPlanId } = req.query;
      if (!school || !grade || !examPlanId) {
        return res
          .status(400)
          .json({
            ok: false,
            error: "school, grade, examPlanId가 필요합니다.",
          });
      }

      const examPlanKey = getExamPlanKey(school, grade);
      let examPlans = (await kv.get(examPlanKey)) || [];
      const planToDelete = examPlans.find((p) => p.id === examPlanId);

      if (!planToDelete) {
        return res
          .status(404)
          .json({ ok: false, error: "삭제할 내신 플랜을 찾지 못했습니다." });
      }

      const { allStudents, allClasses } = await getStudentAndClassData();
      const targetStudents = allStudents.filter(
        (s) => s.school === school && String(s.grade) === String(grade)
      );

      for (const student of targetStudents) {
        const studentClass = allClasses.find((c) => c.id === student.class_id);
        const studentScheduleDays =
          studentClass?.schedule_days || "MON,WED,FRI";
        const studentClassDaysSet = new Set(
          studentScheduleDays.split(",").map((s) => s.trim().toUpperCase())
        );

        const studentPlanKey = getStudentPlanKey(student.id);
        let studentPlans = (await kv.get(studentPlanKey)) || [];
        if (studentPlans.length === 0) continue;

        const planToModify = studentPlans[0];
        const examSegmentId = `seg_exam_${examPlanId}`;
        if (!planToModify.planSegments.some((s) => s.id === examSegmentId))
          continue;

        const daysToShiftBack = countClassDays(
          planToDelete.startDate,
          planToDelete.endDate,
          studentClassDaysSet
        );

        let updatedSegments = planToModify.planSegments.filter(
          (s) => s.id !== examSegmentId
        );

        updatedSegments = updatedSegments.map((segment) => {
          const segmentDaysSet = new Set(
            (segment.days || studentScheduleDays)
              .split(",")
              .map((s) => s.trim().toUpperCase())
          );
          if (toUtcDate(segment.startDate) > toUtcDate(planToDelete.endDate)) {
            const newStart = shiftDateByClassDays(
              segment.startDate,
              -daysToShiftBack,
              segmentDaysSet
            );
            const newEnd = shiftDateByClassDays(
              segment.endDate,
              -daysToShiftBack,
              segmentDaysSet
            );
            return {
              ...segment,
              startDate: toYMD(newStart),
              endDate: toYMD(newEnd),
            };
          }
          return segment;
        });
        planToModify.planSegments = updatedSegments.sort((a, b) =>
          a.startDate.localeCompare(b.startDate)
        );
        await kv.set(studentPlanKey, studentPlans);
      }

      examPlans = examPlans.filter((p) => p.id !== examPlanId);
      await kv.set(examPlanKey, examPlans);

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("내신 플랜 삭제 실패:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
  return res
    .status(405)
    .json({ ok: false, error: `Method ${req.method} Not Allowed` });
}
