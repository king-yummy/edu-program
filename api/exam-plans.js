// /api/exam-plans.js (최종 수정본 - 병합 로직 완전 개선)

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

// =================================================================
// ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ 핵심 수정 함수 ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
// =================================================================
/**
 * 학생의 플랜 구간 배열에서 특정 내신 플랜 구간을 삭제하고,
 * 그로 인해 분리되었던 앞/뒤 일반 플랜 구간을 다시 병합하는 함수
 */
function processSegmentsAfterDeletion(
  segments,
  oldExamPlan,
  studentScheduleDays
) {
  const examIdToRemove = `seg_exam_${oldExamPlan.id}`;
  const examSegmentIndex = segments.findIndex((s) => s.id === examIdToRemove);

  // 삭제할 내신 플랜이 없으면 원본 그대로 반환
  if (examSegmentIndex === -1) {
    return segments;
  }

  const finalSegments = [...segments]; // 조작을 위해 원본 배열 복사

  const prevSegmentIndex = examSegmentIndex - 1;
  const nextSegmentIndex = examSegmentIndex + 1;

  const prevSegment =
    prevSegmentIndex >= 0 ? finalSegments[prevSegmentIndex] : null;
  const nextSegment =
    nextSegmentIndex < finalSegments.length
      ? finalSegments[nextSegmentIndex]
      : null;

  let canMerge = false;
  if (prevSegment && nextSegment) {
    const daysMatch =
      (prevSegment.days || studentScheduleDays) ===
      (nextSegment.days || studentScheduleDays);
    const prevBooks = Object.values(prevSegment.lanes || {})
      .flat()
      .map((b) => b.instanceId)
      .sort();
    const nextBooks = Object.values(nextSegment.lanes || {})
      .flat()
      .map((b) => b.instanceId)
      .sort();

    // 조건: 요일 설정이 같고, 교재 구성이 같거나, 뒷구간의 교재가 비어있다면 병합 가능
    if (daysMatch && JSON.stringify(prevBooks) === JSON.stringify(nextBooks)) {
      canMerge = true;
    }
  }

  if (canMerge) {
    // [병합 실행]
    // 앞 구간의 교재 정보를 기반으로, 뒷 구간의 '종료 차시' 정보만 가져와 합칩니다.
    const mergedLanes = JSON.parse(JSON.stringify(prevSegment.lanes));
    for (const lane in mergedLanes) {
      mergedLanes[lane].forEach((book) => {
        const nextBook = nextSegment.lanes?.[lane]?.find(
          (b) => b.instanceId === book.instanceId
        );
        if (nextBook) {
          book.endUnitCode = nextBook.endUnitCode;
        }
      });
    }

    // 앞 구간을 기준으로 날짜와 교재 정보를 합친 새로운 구간 생성
    const mergedSegment = {
      ...prevSegment,
      endDate: nextSegment.endDate, // 종료일은 뒷 구간의 것을 사용
      lanes: mergedLanes, // 교재 정보는 합친 것을 사용
    };

    // 기존의 3개 구간(앞, 내신, 뒤)을 삭제하고, 합쳐진 1개의 구간으로 교체
    finalSegments.splice(prevSegmentIndex, 3, mergedSegment);
  } else {
    // [병합 불가] 내신 구간만 깔끔하게 삭제
    finalSegments.splice(examSegmentIndex, 1);
  }

  // [날짜 재조정] 삭제된 내신 기간만큼 이후의 모든 플랜 날짜를 앞으로 당김
  const daysToShiftBack = -Math.abs(
    countClassDays(
      oldExamPlan.startDate,
      oldExamPlan.endDate,
      new Set(studentScheduleDays.split(","))
    )
  );
  const oldExamEndUtc = toUtcDate(oldExamPlan.endDate);

  return finalSegments.map((seg) => {
    // 내신 기간보다 뒤에 시작하는 구간들만 날짜를 이동시킴
    if (toUtcDate(seg.startDate) > oldExamEndUtc) {
      const segDaysSet = new Set((seg.days || studentScheduleDays).split(","));
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
// =================================================================
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ 핵심 수정 함수 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
// =================================================================

// --- API 핸들러 (이하 변경 없음) ---
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
