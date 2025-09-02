// /api/exam-plans.js — 신규 파일 (핵심 로직 구현)

import { kv } from "@vercel/kv";
import { readSheetObjects } from "../lib/sheets.js";

// --- 날짜 계산을 위한 Helper 함수들 ---
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const toUtcDate = (dateString) => {
  const [year, month, day] = (dateString || "")
    .split("T")[0]
    .split("-")
    .map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};
const toYMD = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

/** 특정 기간 내에 포함된 수업일수(class days)를 계산하는 함수 */
function countClassDays(startDate, endDate, classDaysSet) {
  let count = 0;
  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    if (classDaysSet.has(DOW[d.getUTCDay()])) {
      count++;
    }
  }
  return count;
}

/** 특정 날짜로부터 N개의 수업일수만큼 뒤의 날짜를 계산하는 함수 */
function shiftDateByClassDays(startDate, daysToShift, classDaysSet) {
  let shiftedDate = toUtcDate(startDate);
  let daysCounted = 0;
  while (daysCounted < daysToShift) {
    shiftedDate = addDays(shiftedDate, 1);
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

// --- 메인 API 핸들러 ---
export default async function handler(req, res) {
  if (!isKvReady()) {
    return res
      .status(501)
      .json({ ok: false, error: "KV 데이터베이스가 설정되지 않았습니다." });
  }

  // --- GET: 내신 플랜 목록 조회 ---
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

      // 1. 대상 학생 및 반 정보 조회
      const [allStudents, allClasses] = await Promise.all([
        readSheetObjects(process.env.STUDENTS_RANGE || "student!A:Z"),
        readSheetObjects(process.env.CLASSES_RANGE || "class!A:Z"),
      ]);
      const targetStudents = allStudents.filter(
        (s) => s.school === school && String(s.grade) === String(grade)
      );

      if (targetStudents.length === 0) {
        return res
          .status(404)
          .json({ ok: false, error: "해당하는 학생을 찾을 수 없습니다." });
      }

      const newExamPlan = {
        ...planData,
        id: `exam_${Date.now()}`,
        createdAt: new Date().toISOString(),
      };

      // 2. [핵심] 학생별로 기존 플랜에 내신 플랜 삽입/수정
      for (const student of targetStudents) {
        const studentClass = allClasses.find((c) => c.id === student.class_id);
        const studentScheduleDays =
          studentClass?.schedule_days || "MON,WED,FRI";
        const studentClassDaysSet = new Set(
          studentScheduleDays.split(",").map((s) => s.trim().toUpperCase())
        );

        const studentPlanKey = getStudentPlanKey(student.id);
        let studentPlans = (await kv.get(studentPlanKey)) || [];

        // Case 1: 기존 플랜이 없는 경우
        if (studentPlans.length === 0) {
          const newPlan = {
            planId: `pln_exam_${student.id}_${newExamPlan.id}`,
            studentId: student.id,
            planSegments: [
              {
                id: `seg_exam_${newExamPlan.id}`,
                ...planData,
              },
            ],
            userSkips: {},
          };
          studentPlans.push(newPlan);
          await kv.set(studentPlanKey, studentPlans);
          continue; // 다음 학생으로
        }

        // Case 2: 기존 플랜이 있는 경우
        const examStartDate = newExamPlan.startDate;
        const examEndDate = newExamPlan.endDate;

        let planToModify = studentPlans.find((p) =>
          p.planSegments.some(
            (s) => examStartDate >= s.startDate && examStartDate <= s.endDate
          )
        );

        // 겹치는 플랜이 없으면, 새 플랜으로 추가 (혹은 다른 정책 적용 가능)
        if (!planToModify) {
          const newPlan = {
            planId: `pln_exam_${student.id}_${newExamPlan.id}`,
            studentId: student.id,
            planSegments: [{ id: `seg_exam_${newExamPlan.id}`, ...planData }],
            userSkips: {},
          };
          studentPlans.push(newPlan);
          await kv.set(studentPlanKey, studentPlans);
          continue;
        }

        const originalSegments = planToModify.planSegments;
        const newSegments = [];

        const daysToShift = countClassDays(
          examStartDate,
          examEndDate,
          studentClassDaysSet
        );

        for (const segment of originalSegments) {
          // 내신 기간과 전혀 겹치지 않는 이전 구간
          if (segment.endDate < examStartDate) {
            newSegments.push(segment);
            continue;
          }
          // 내신 기간이 완전히 포함되는 구간 (분할 대상)
          if (
            segment.startDate < examStartDate &&
            segment.endDate > examEndDate
          ) {
            // beforeSegment
            newSegments.push({
              ...segment,
              endDate: toYMD(addDays(toUtcDate(examStartDate), -1)),
            });
            // examSegment
            newSegments.push({ id: `seg_exam_${newExamPlan.id}`, ...planData });
            // afterSegment (밀림 처리)
            const originalAfterStart = toUtcDate(examEndDate);
            const newAfterStart = shiftDateByClassDays(
              originalAfterStart,
              1,
              studentClassDaysSet
            );

            const afterDurationDays = countClassDays(
              toYMD(addDays(toUtcDate(examEndDate), 1)),
              segment.endDate,
              studentClassDaysSet
            );
            const newAfterEnd = shiftDateByClassDays(
              newAfterStart,
              afterDurationDays - 1,
              studentClassDaysSet
            );

            newSegments.push({
              ...segment,
              startDate: toYMD(newAfterStart),
              endDate: toYMD(newAfterEnd),
            });
          } else {
            // 걸치거나, 내신 기간 이후의 모든 구간은 밀어야 함
            const newStartDate = shiftDateByClassDays(
              toUtcDate(segment.startDate),
              daysToShift,
              studentClassDaysSet
            );
            const duration = countClassDays(
              segment.startDate,
              segment.endDate,
              studentClassDaysSet
            );
            const newEndDate = shiftDateByClassDays(
              newStartDate,
              duration - 1,
              studentClassDaysSet
            );
            newSegments.push({
              ...segment,
              startDate: toYMD(newStartDate),
              endDate: toYMD(newEndDate),
            });
          }
        }

        planToModify.planSegments = newSegments;
        await kv.set(studentPlanKey, studentPlans);
      }

      // 3. 학교/학년별 내신 플랜 목록에 새 플랜 추가 및 저장
      const examPlanKey = getExamPlanKey(school, grade);
      let examPlans = (await kv.get(examPlanKey)) || [];
      examPlans.push(newExamPlan);
      await kv.set(examPlanKey, examPlans);

      return res.status(201).json({ ok: true, newExamPlan });
    } catch (e) {
      console.error("내신 플랜 생성 실패:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- DELETE: 내신 플랜 삭제 ---
  if (req.method === "DELETE") {
    /* ... (기존과 동일) ... */
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res
    .status(405)
    .json({ ok: false, error: `Method ${req.method} Not Allowed` });
}
