// /api/exam-plans.js

import { kv } from "@vercel/kv";
import { readSheetObjects } from "../lib/sheets.js";

// --- 날짜 계산을 위한 Helper 함수들 ---
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const toUtcDate = (dateString) => {
  if (!dateString || typeof dateString !== "string") {
    // 유효하지 않은 입력에 대한 기본값 반환
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

// 특정 기간 내의 수업일수를 계산하는 함수
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

// 수업일수만큼 날짜를 이동시키는 함수 (양수: 뒤로, 음수: 앞으로)
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

// --- KV 저장을 위한 Helper 함수들 ---
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

  // --- POST: 새 내신 플랜 생성 및 학생 플랜에 적용 (기존 로직 유지 및 개선) ---
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
          days: studentScheduleDays,
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

        // 학생 플랜에 내신 기간 삽입 및 기존 플랜 조정
        const planToModify = studentPlans[0]; // 단순화를 위해 첫 번째 플랜을 대상으로 가정
        const originalSegments = planToModify.planSegments;
        const newSegments = [];
        const examStartDate = examSegmentData.startDate;
        const examEndDate = examSegmentData.endDate;
        const examStartDateUtc = toUtcDate(examStartDate);

        const daysToShift = countClassDays(
          examStartDate,
          examEndDate,
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

          if (
            segmentStartUtc < examStartDateUtc &&
            segmentEndUtc >= examStartDateUtc
          ) {
            newSegments.push({
              ...segment,
              endDate: toYMD(addDays(examStartDateUtc, -1)),
            });

            const shiftedEnd = shiftDateByClassDays(
              segment.endDate,
              daysToShift,
              studentClassDaysSet
            );
            newSegments.push({
              ...segment,
              startDate: toYMD(addDays(toUtcDate(examEndDate), 1)),
              endDate: toYMD(shiftedEnd),
            });
            continue;
          }

          if (segmentStartUtc >= examStartDateUtc) {
            const shiftedStart = shiftDateByClassDays(
              segment.startDate,
              daysToShift,
              studentClassDaysSet
            );
            const shiftedEnd = shiftDateByClassDays(
              segment.endDate,
              daysToShift,
              studentClassDaysSet
            );
            newSegments.push({
              ...segment,
              startDate: toYMD(shiftedStart),
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

  // --- PUT: 기존 내신 플랜 수정 및 모든 학생 플랜에 반영 ---
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

      // --- 학생 플랜 업데이트 로직 시작 ---
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

        // 1. 기존 내신 기간 제거 및 플랜 당기기
        const oldDaysCount = countClassDays(
          oldPlanData.startDate,
          oldPlanData.endDate,
          studentClassDaysSet
        );
        const oldExamSegmentId = `seg_exam_${examPlanId}`;
        segments = segments.filter((s) => s.id !== oldExamSegmentId);

        segments = segments.map((segment) => {
          if (toUtcDate(segment.startDate) > toUtcDate(oldPlanData.endDate)) {
            const newStart = shiftDateByClassDays(
              segment.startDate,
              -oldDaysCount,
              studentClassDaysSet
            );
            const newEnd = shiftDateByClassDays(
              segment.endDate,
              -oldDaysCount,
              studentClassDaysSet
            );
            return {
              ...segment,
              startDate: toYMD(newStart),
              endDate: toYMD(newEnd),
            };
          }
          return segment;
        });

        // 2. 새로운 내신 기간 삽입 및 플랜 밀기
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

        let finalSegments = [];
        for (const segment of segments) {
          const segmentStartUtc = toUtcDate(segment.startDate);
          const segmentEndUtc = toUtcDate(segment.endDate);

          if (segmentEndUtc < newExamStartUtc) {
            finalSegments.push(segment);
            continue;
          }
          if (segmentStartUtc >= newExamStartUtc) {
            const shiftedStart = shiftDateByClassDays(
              segment.startDate,
              newDaysCount,
              studentClassDaysSet
            );
            const shiftedEnd = shiftDateByClassDays(
              segment.endDate,
              newDaysCount,
              studentClassDaysSet
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
              studentClassDaysSet
            );
            finalSegments.push({
              ...segment,
              startDate: toYMD(addDays(toUtcDate(updatedPlanData.endDate), 1)),
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
      // --- 학생 플랜 업데이트 로직 종료 ---

      await kv.set(examPlanKey, examPlans);
      return res
        .status(200)
        .json({ ok: true, updatedExamPlan: updatedPlanData });
    } catch (e) {
      console.error("내신 플랜 수정 실패:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- DELETE: 내신 플랜 삭제 및 모든 학생 플랜에서 제거/조정 ---
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

      // --- 학생 플랜 업데이트 로직 시작 ---
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

        // 내신 기간 제거 및 플랜 당기기
        const daysToShiftBack = countClassDays(
          planToDelete.startDate,
          planToDelete.endDate,
          studentClassDaysSet
        );

        let updatedSegments = planToModify.planSegments.filter(
          (s) => s.id !== examSegmentId
        );

        updatedSegments = updatedSegments.map((segment) => {
          if (toUtcDate(segment.startDate) > toUtcDate(planToDelete.endDate)) {
            const newStart = shiftDateByClassDays(
              segment.startDate,
              -daysToShiftBack,
              studentClassDaysSet
            );
            const newEnd = shiftDateByClassDays(
              segment.endDate,
              -daysToShiftBack,
              studentClassDaysSet
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
      // --- 학생 플랜 업데이트 로직 종료 ---

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
