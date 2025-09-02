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
  let shiftedDate = new Date(startDate);
  if (daysToShift <= 0) return shiftedDate;
  let daysCounted = 0;
  while (daysCounted < daysToShift) {
    shiftedDate = addDays(shiftedDate, 1);
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

      const newExamPlanForRecord = {
        ...planData,
        id: `exam_${Date.now()}`,
        createdAt: new Date().toISOString(),
      };

      for (const student of targetStudents) {
        const studentClass = allClasses.find((c) => c.id === student.class_id);
        const studentScheduleDays =
          studentClass?.schedule_days || "MON,WED,FRI";

        const studentPlanKey = getStudentPlanKey(student.id);
        let studentPlans = (await kv.get(studentPlanKey)) || [];

        // [수정] 각 학생의 개별 수강 요일을 사용하여 내신 플랜 구간 데이터를 명시적으로 생성합니다.
        // 이 수정으로 인해 대표 학생의 요일이 다른 학생에게 잘못 적용되던 문제를 해결합니다.
        const examSegmentData = {
          title: planData.title,
          startDate: planData.startDate,
          endDate: planData.endDate,
          lanes: planData.lanes,
          days: studentScheduleDays,
        };

        if (studentPlans.length === 0) {
          const newPlan = {
            planId: `pln_exam_${student.id}_${newExamPlanForRecord.id}`,
            studentId: student.id,
            planSegments: [
              {
                id: `seg_exam_${newExamPlanForRecord.id}`,
                ...examSegmentData,
              },
            ],
            userSkips: {},
          };
          studentPlans.push(newPlan);
          await kv.set(studentPlanKey, studentPlans);
          continue;
        }

        const examStartDate = examSegmentData.startDate;
        const examEndDate = examSegmentData.endDate;
        const examStartDateUtc = toUtcDate(examStartDate);

        const daysToShift = countClassDays(
          examStartDate,
          examEndDate,
          new Set(
            studentScheduleDays.split(",").map((s) => s.trim().toUpperCase())
          )
        );

        if (daysToShift <= 0) {
          continue;
        }

        let planToModify =
          studentPlans.find((p) =>
            p.planSegments.some((s) => s.endDate >= examStartDate)
          ) || studentPlans[0];

        if (!planToModify) {
          planToModify = studentPlans[studentPlans.length - 1];
        }

        const originalSegments = planToModify.planSegments;
        const newSegments = [];

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

            const studentClassDaysSet = new Set(
              (segment.days || studentScheduleDays)
                .split(",")
                .map((s) => s.trim().toUpperCase())
            );

            const newPartB_Start = shiftDateByClassDays(
              examStartDateUtc,
              daysToShift,
              studentClassDaysSet
            );
            const newPartB_End = shiftDateByClassDays(
              segmentEndUtc,
              daysToShift,
              studentClassDaysSet
            );

            if (newPartB_Start <= newPartB_End) {
              newSegments.push({
                ...segment,
                startDate: toYMD(newPartB_Start),
                endDate: toYMD(newPartB_End),
              });
            }
            continue;
          }

          if (segmentStartUtc >= examStartDateUtc) {
            const studentClassDaysSet = new Set(
              (segment.days || studentScheduleDays)
                .split(",")
                .map((s) => s.trim().toUpperCase())
            );

            const newSeg_Start = shiftDateByClassDays(
              segmentStartUtc,
              daysToShift,
              studentClassDaysSet
            );
            const newSeg_End = shiftDateByClassDays(
              segmentEndUtc,
              daysToShift,
              studentClassDaysSet
            );
            newSegments.push({
              ...segment,
              startDate: toYMD(newSeg_Start),
              endDate: toYMD(newSeg_End),
            });
            continue;
          }
        }

        newSegments.push({
          id: `seg_exam_${newExamPlanForRecord.id}`,
          ...examSegmentData,
        });

        newSegments.sort((a, b) => a.startDate.localeCompare(b.startDate));
        planToModify.planSegments = newSegments;
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

  // --- PUT: 기존 내신 플랜 수정 (변경 없음) ---
  if (req.method === "PUT") {
    try {
      const { school, grade, examPlanId, planData } = req.body;
      if (!school || !grade || !examPlanId || !planData) {
        return res.status(400).json({
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

      examPlans[planIndex] = {
        ...examPlans[planIndex],
        ...planData,
        id: examPlanId,
        updatedAt: new Date().toISOString(),
      };

      await kv.set(examPlanKey, examPlans);

      return res
        .status(200)
        .json({ ok: true, updatedExamPlan: examPlans[planIndex] });
    } catch (e) {
      console.error("내신 플랜 수정 실패:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- DELETE: 내신 플랜 삭제 (변경 없음) ---
  if (req.method === "DELETE") {
    try {
      const { school, grade, examPlanId } = req.query;
      if (!school || !grade || !examPlanId) {
        return res.status(400).json({
          ok: false,
          error: "school, grade, examPlanId가 필요합니다.",
        });
      }

      const examPlanKey = getExamPlanKey(school, grade);
      let examPlans = (await kv.get(examPlanKey)) || [];

      const initialLength = examPlans.length;
      examPlans = examPlans.filter((p) => p.id !== examPlanId);

      if (examPlans.length === initialLength) {
        return res
          .status(404)
          .json({ ok: false, error: "삭제할 내신 플랜을 찾지 못했습니다." });
      }

      await kv.set(examPlanKey, examPlans);

      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
  return res
    .status(405)
    .json({ ok: false, error: `Method ${req.method} Not Allowed` });
}
