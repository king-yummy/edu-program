// /api/exam-plans.js (최종 수정본 - 진도 계산 후 분할)

import { kv } from "@vercel/kv";
import { readSheetObjects } from "../lib/sheets.js";
import { calculateProgress } from "../lib/schedule.js"; // [핵심] 진도 계산 함수 import

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

// [신규] '논리적 병합'을 수행하는 플랜 정리 함수
function cleanupAndMergeSegments(segments, studentScheduleDays) {
  if (segments.length < 2) return segments;

  let merged = [];
  let accumulator = segments[0];

  for (let i = 1; i < segments.length; i++) {
    let next = segments[i];
    const effectiveDays = accumulator.days || studentScheduleDays;
    const scheduleSet = new Set(
      effectiveDays.split(",").map((d) => d.trim().toUpperCase())
    );
    const nextDayAfterAccumulator = toYMD(
      shiftDateByClassDays(accumulator.endDate, 1, scheduleSet)
    );

    const lanesId1 = JSON.stringify(
      Object.values(accumulator.lanes || {}).flatMap((l) =>
        (l || []).map((b) => b.instanceId).sort()
      )
    );
    const lanesId2 = JSON.stringify(
      Object.values(next.lanes || {}).flatMap((l) =>
        (l || []).map((b) => b.instanceId).sort()
      )
    );

    if (
      next.startDate === nextDayAfterAccumulator &&
      lanesId1 === lanesId2 &&
      lanesId1 !== "[]"
    ) {
      accumulator.endDate = next.endDate;
    } else {
      merged.push(accumulator);
      accumulator = next;
    }
  }
  merged.push(accumulator);
  return merged;
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
      if (studentPlans.length === 0) continue;

      const studentClass = allClasses.find((c) => c.id === student.class_id);
      const classDefaultDays = studentClass?.schedule_days || "MON,WED,FRI";
      const studentScheduleDays =
        studentPlans[0]?.planSegments?.find((seg) => seg.days)?.days ||
        classDefaultDays;

      let currentSegments = studentPlans[0].planSegments;

      // [수정] PUT, DELETE 시에는 먼저 기존 내신 플랜을 제거하고 시작
      if (req.method === "PUT" || req.method === "DELETE") {
        const planRecord = examPlans.find((p) => p.id === examPlanId);
        if (!planRecord) continue;

        const examSegId = `seg_exam_${planRecord.id}`;
        currentSegments = currentSegments.filter((s) => s.id !== examSegId);
      }

      // [수정] 분할되었을 수 있는 플랜들을 병합하여 정리
      currentSegments = cleanupAndMergeSegments(
        currentSegments,
        studentScheduleDays
      );

      // [수정] POST, PUT 시에만 새 내신 플랜을 다시 삽입
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
          if (segStartUtc > newExamStartUtc) {
            currentSegments.push(seg);
            continue;
          }

          // [핵심] 분할 로직
          const partA = {
            ...seg,
            endDate: toYMD(addDays(newExamStartUtc, -1)),
          };
          if (toUtcDate(partA.startDate) <= toUtcDate(partA.endDate)) {
            currentSegments.push(partA);
          }

          const progressItems = await calculateProgress(partA, {
            mainBook,
            vocaBook,
          });
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
                return null; // 완료된 책은 Part B에서 제외
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

      studentPlans[0].planSegments = currentSegments;
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
