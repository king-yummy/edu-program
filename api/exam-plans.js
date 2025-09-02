// /api/exam-plans.js (최종 수정본 - 선삭제 후처리 및 논리 병합)

import { kv } from "@vercel/kv";
import { readSheetObjects } from "../lib/sheets.js";
import { calculateProgress } from "../lib/schedule.js";

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

// --- 학생별 플랜 조작 함수 (핵심 수정) ---
function processSegmentsAfterDeletion(
  segments,
  oldExamPlan,
  studentScheduleDays
) {
  const examIdToRemove = `seg_exam_${oldExamPlan.id}`;
  const originalExamIndex = segments.findIndex((s) => s.id === examIdToRemove);

  if (originalExamIndex === -1) return segments;

  // 1. 선(先)삭제: 먼저 내신 플랜을 무조건 제거한다.
  const segmentsWithoutExam = segments.filter((s) => s.id !== examIdToRemove);
  if (segmentsWithoutExam.length < 1) return []; // 다 지우고 남는게 없으면 빈 배열 반환

  // 2. 후(後)처리: 병합 또는 날짜 이동
  const studentDaysSet = new Set(
    studentScheduleDays.split(",").map((d) => d.trim().toUpperCase())
  );
  const daysToShiftBack = -Math.abs(
    countClassDays(oldExamPlan.startDate, oldExamPlan.endDate, studentDaysSet)
  );
  const oldExamEndUtc = toUtcDate(oldExamPlan.endDate);

  // 2-1. 논리적 병합 시도
  const prevSegmentOriginal =
    originalExamIndex > 0 ? segments[originalExamIndex - 1] : null;
  const nextSegmentOriginal =
    originalExamIndex < segments.length - 1
      ? segments[originalExamIndex + 1]
      : null;

  if (prevSegmentOriginal && nextSegmentOriginal) {
    const prevLanesId = JSON.stringify(
      Object.values(prevSegmentOriginal.lanes || {}).flatMap((lane) =>
        (lane || []).map((b) => b.instanceId).sort()
      )
    );
    const nextLanesId = JSON.stringify(
      Object.values(nextSegmentOriginal.lanes || {}).flatMap((lane) =>
        (lane || []).map((b) => b.instanceId).sort()
      )
    );
    const daysMatch =
      (prevSegmentOriginal.days || studentScheduleDays) ===
      (nextSegmentOriginal.days || studentScheduleDays);

    if (prevLanesId === nextLanesId && prevLanesId !== "[]" && daysMatch) {
      const mergedSegment = {
        ...prevSegmentOriginal,
        endDate: nextSegmentOriginal.endDate,
      };

      // 삭제된 배열에서 이전/다음 조각을 찾아 합쳐진 하나로 교체
      const finalSegments = segmentsWithoutExam.filter(
        (s) =>
          s.id !== prevSegmentOriginal.id && s.id !== nextSegmentOriginal.id
      );
      finalSegments.push(mergedSegment);
      finalSegments.sort((a, b) => a.startDate.localeCompare(b.startDate));

      // 병합된 경우, 날짜 이동은 병합된 최종본을 기준으로 다시 계산해야 함
      return finalSegments.map((seg) => {
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
  }

  // 2-2. 병합 대상이 아닌 경우, 단순 날짜 이동만 수행
  return segmentsWithoutExam.map((seg) => {
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
  // ... 핸들러의 나머지 부분은 이전과 동일하게 유지 ...
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
    const [mainBook, vocaBook] = await Promise.all([
      readSheetObjects("mainBook"),
      readSheetObjects("vocaBook"),
    ]);

    const targetStudents = allStudents.filter(
      (s) => s.school === school && String(s.grade) === String(grade)
    );
    if (targetStudents.length === 0)
      return res
        .status(404)
        .json({ ok: false, error: "해당 학생이 없습니다." });

    const examPlanKey = getExamPlanKey(school, grade);
    let examPlans = (await kv.get(examPlanKey)) || [];

    for (const student of targetStudents) {
      const studentPlanKey = getStudentPlanKey(student.id);
      let studentPlans = (await kv.get(studentPlanKey)) || [];
      if (studentPlans.length === 0 && req.method !== "POST") continue;

      const studentClass = allClasses.find((c) => c.id === student.class_id);
      const classDefaultDays = studentClass?.schedule_days || "MON,WED,FRI";

      const studentScheduleDays =
        studentPlans[0]?.planSegments?.find((seg) => seg.days)?.days ||
        classDefaultDays;

      let currentSegments = studentPlans[0]?.planSegments || [];

      if (req.method === "PUT" || req.method === "DELETE") {
        const planRecord = examPlans.find((p) => p.id === examPlanId);
        if (!planRecord) continue;
        currentSegments = processSegmentsAfterDeletion(
          currentSegments,
          planRecord,
          studentScheduleDays
        );
      }

      if (req.method === "POST" || req.method === "PUT") {
        const { planData } = req.body;
        const examRecordId =
          req.method === "PUT" ? examPlanId : `exam_${Date.now()}`;

        const newExamSegment = {
          ...planData,
          id: `seg_exam_${examRecordId}`,
          days: studentScheduleDays,
        };
        const newExamStartUtc = toUtcDate(newExamSegment.startDate);

        const segmentsToInsertInto = [...currentSegments];
        currentSegments = [];

        for (const seg of segmentsToInsertInto) {
          const segStartUtc = toUtcDate(seg.startDate);
          const segEndUtc = toUtcDate(seg.endDate);

          if (segEndUtc < newExamStartUtc) {
            currentSegments.push(seg);
            continue;
          }
          if (segStartUtc >= newExamStartUtc) {
            // 오타 수정: > -> >=
            currentSegments.push(seg);
            continue;
          }

          const partA = {
            ...seg,
            endDate: toYMD(addDays(newExamStartUtc, -1)),
          };
          if (toUtcDate(partA.startDate) <= toUtcDate(partA.endDate)) {
            currentSegments.push(partA);
          }

          const progressItems = await calculateProgress(
            { ...partA, days: seg.days || studentScheduleDays },
            { mainBook, vocaBook }
          );
          const lastUnits = progressItems.reduce((acc, item) => {
            if (item.instanceId) acc[item.instanceId] = item.unit_code;
            return acc;
          }, {});

          const partB_lanes = JSON.parse(JSON.stringify(seg.lanes));
          const allBookUnits = [...mainBook, ...vocaBook];

          for (const lane in partB_lanes) {
            partB_lanes[lane] = partB_lanes[lane]
              .map((book) => {
                const lastUnitCode = lastUnits[book.instanceId];
                if (!lastUnitCode) return book;
                const bookUnits = allBookUnits
                  .filter((u) => u.material_id === book.materialId)
                  .sort((a, b) => Number(a.order) - Number(b.order));
                const lastUnitIdx = bookUnits.findIndex(
                  (u) => u.unit_code === lastUnitCode
                );
                if (lastUnitIdx > -1 && lastUnitIdx + 1 < bookUnits.length) {
                  return {
                    ...book,
                    startUnitCode: bookUnits[lastUnitIdx + 1].unit_code,
                  };
                }
                return null;
              })
              .filter(Boolean);
          }

          const partB = {
            ...seg,
            startDate: toYMD(addDays(toUtcDate(newExamSegment.endDate), 1)),
            lanes: partB_lanes,
          };
          if (toUtcDate(partB.startDate) <= toUtcDate(partB.endDate)) {
            currentSegments.push(partB);
          }
        }
        currentSegments.push(newExamSegment);
        currentSegments.sort((a, b) => a.startDate.localeCompare(b.startDate));
      }

      if (studentPlans.length > 0) {
        studentPlans[0].planSegments = currentSegments;
      } else {
        studentPlans.push({
          planId: `pln_${student.id}`,
          studentId: student.id,
          planSegments: currentSegments,
          userSkips: {},
        });
      }
      await kv.set(studentPlanKey, studentPlans);
    }

    // --- 마스터 내신 플랜 목록 업데이트 ---
    if (req.method === "POST") {
      const { planData } = req.body;
      const examRecordId = `exam_${Date.now()}`;
      examPlans.push({ ...planData, id: examRecordId });
      await kv.set(examPlanKey, examPlans);
      return res.status(201).json({ ok: true });
    }
    if (req.method === "PUT") {
      const { planData } = req.body;
      const planIndex = examPlans.findIndex((p) => p.id === examPlanId);
      examPlans[planIndex] = {
        ...examPlans[planIndex],
        ...planData,
        updatedAt: new Date().toISOString(),
      };
      await kv.set(examPlanKey, examPlans);
      return res.status(200).json({ ok: true });
    }
    if (req.method === "DELETE") {
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
