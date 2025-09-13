// /api/exam-plans.js (최종 수정본)

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

/**
 * 학생의 플랜 구간 배열에서 특정 내신 플랜 구간을 삭제하고,
 * 그로 인해 분리되었던 앞/뒤 일반 플랜 구간을 다시 병합하는 함수
 * 기존 examPlan.id 앞에 'exam_'이 붙은 경우와 아닌 경우를 모두 고려하도록 수정하였다.
 */
function processSegmentsAfterDeletion(
  segments,
  oldExamPlan,
  studentScheduleDays
) {
  // 삭제할 세그먼트 ID는 두 가지 패턴을 모두 검색하도록 한다.
  const possibleExamIds = [];
  // 기본 패턴: seg_exam_ + examPlan.id
  possibleExamIds.push(`seg_exam_${oldExamPlan.id}`);
  // examPlan.id가 'exam_' 접두사로 시작하면, 접두사를 제거한 ID도 검색 대상에 포함한다.
  if (
    typeof oldExamPlan.id === "string" &&
    oldExamPlan.id.startsWith("exam_")
  ) {
    possibleExamIds.push(`seg_exam_${oldExamPlan.id.replace(/^exam_/, "")}`);
  }
  const examSegmentIndex = segments.findIndex((s) =>
    possibleExamIds.includes(s.id)
  );

  if (examSegmentIndex === -1) {
    return segments;
  }

  const finalSegments = [...segments];

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

    if (daysMatch && JSON.stringify(prevBooks) === JSON.stringify(nextBooks)) {
      canMerge = true;
    }
  }

  if (canMerge) {
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

    const mergedSegment = {
      ...prevSegment,
      endDate: nextSegment.endDate,
      lanes: mergedLanes,
    };

    finalSegments.splice(prevSegmentIndex, 3, mergedSegment);
  } else {
    finalSegments.splice(examSegmentIndex, 1);
  }

  const daysToShiftBack = -Math.abs(
    countClassDays(
      oldExamPlan.startDate,
      oldExamPlan.endDate,
      new Set(studentScheduleDays.split(","))
    )
  );
  const oldExamEndUtc = toUtcDate(oldExamPlan.endDate);

  return finalSegments.map((seg) => {
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
    const examPlanKey = getExamPlanKey(school, grade);

    // --- GET 요청 처리 ---
    if (req.method === "GET") {
      const examPlans = (await kv.get(examPlanKey)) || [];
      return res.status(200).json({ ok: true, examPlans });
    }

    // --- POST, PUT, DELETE를 위한 공통 데이터 로딩 ---
    const [allStudents, allClasses] = await getStudentAndClassData();
    const targetStudents = allStudents.filter(
      (s) => s.school === school && String(s.grade) === String(grade)
    );

    if (targetStudents.length === 0 && req.method !== "GET")
      return res
        .status(404)
        .json({ ok: false, error: "해당 학생이 없습니다." });

    let examPlans = (await kv.get(examPlanKey)) || [];

    // --- DELETE 요청 처리 ---
    if (req.method === "DELETE") {
      if (!examPlanId)
        return res
          .status(400)
          .json({ ok: false, error: "examPlanId가 필요합니다." });

      const planRecordToDelete = examPlans.find((p) => p.id === examPlanId);
      if (!planRecordToDelete) {
        return res
          .status(404)
          .json({ ok: false, error: "삭제할 내신 플랜을 찾지 못했습니다." });
      }

      for (const student of targetStudents) {
        const studentPlanKey = getStudentPlanKey(student.id);
        const studentPlans = (await kv.get(studentPlanKey)) || [];
        if (!studentPlans.length) continue;

        const studentClass = allClasses.find((c) => c.id === student.class_id);
        const classDefaultDays = studentClass?.schedule_days || "MON,WED,FRI";

        // 모든 플랜(plan)을 순회하면서 시험 세그먼트를 제거하고 이후 일정도 재조정한다.
        let anyUpdated = false;
        for (const plan of studentPlans) {
          if (!plan.planSegments) continue;
          const scheduleDays =
            plan.planSegments.find((seg) => seg.days)?.days || classDefaultDays;
          const updatedSegments = processSegmentsAfterDeletion(
            plan.planSegments,
            planRecordToDelete,
            scheduleDays
          );
          plan.planSegments = updatedSegments;
          anyUpdated = true;
        }
        // 수정된 데이터가 있을 때만 저장한다.
        if (anyUpdated) {
          await kv.set(studentPlanKey, studentPlans);
        }
      }

      const updatedExamPlans = examPlans.filter((p) => p.id !== examPlanId);
      await kv.set(examPlanKey, updatedExamPlans);
      return res.status(200).json({ ok: true });
    }

    // --- POST, PUT을 위한 추가 데이터 로딩 ---
    const [mainBook, vocaBook] = await Promise.all([
      readSheetObjects("mainBook"),
      readSheetObjects("vocaBook"),
    ]);

    // ▼▼▼ [수정] ID 생성을 이 위치로 이동하여 한번만 실행되도록 합니다. ▼▼▼
    const { planData } = req.body;
    const examRecordId =
      req.method === "PUT" ? examPlanId : `exam_${Date.now()}`;
    // ▲▲▲ 수정된 부분 ▲▲▲

    // --- PUT 또는 POST 요청에 대한 학생 플랜 업데이트 로직 ---
    for (const student of targetStudents) {
      const studentPlanKey = getStudentPlanKey(student.id);
      let studentPlans = (await kv.get(studentPlanKey)) || [];
      if (studentPlans.length === 0 && req.method === "PUT") continue;

      const studentClass = allClasses.find((c) => c.id === student.class_id);
      const classDefaultDays = studentClass?.schedule_days || "MON,WED,FRI";
      const studentScheduleDays =
        studentPlans[0]?.planSegments?.find((seg) => seg.days)?.days ||
        classDefaultDays;

      let currentSegments = studentPlans[0]?.planSegments || [];

      if (req.method === "PUT") {
        const planRecord = examPlans.find((p) => p.id === examPlanId);
        if (!planRecord) continue;
        currentSegments = processSegmentsAfterDeletion(
          currentSegments,
          planRecord,
          studentScheduleDays
        );
      }

      const newExamSegment = {
        ...planData, // startDate, endDate, title 등 나머지 정보 포함
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

        const partA = { ...seg, endDate: toYMD(addDays(newExamStartUtc, -1)) };
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
      // ▼▼▼ [수정] 위에서 생성한 동일한 ID를 사용합니다. ▼▼▼
      examPlans.push({ ...planData, id: examRecordId });
      await kv.set(examPlanKey, examPlans);
      return res.status(201).json({ ok: true });
    }
    if (req.method === "PUT") {
      const planIndex = examPlans.findIndex((p) => p.id === examPlanId);
      examPlans[planIndex] = {
        ...examPlans[planIndex],
        ...planData,
        updatedAt: new Date().toISOString(),
      };
      await kv.set(examPlanKey, examPlans);
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
