// /api/exam-plans.js (GPT 분석 기반 최종 수정본)

import { kv } from "@vercel/kv";
import { readSheetObjects } from "../lib/sheets.js";
import { calculateProgress } from "../lib/schedule.js";

// --- 날짜 계산 Helper 함수들 (변경 없음) ---
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

// --- KV 및 데이터 조회 Helper (변경 없음) ---
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

// --- 플랜 삭제 및 병합 로직 ---
function processSegmentsAfterDeletion(
  segments,
  oldExamPlan,
  studentScheduleDays
) {
  // ▼▼▼ ID 조회 방식 수정 ▼▼▼
  // 이제 oldExamPlan.id는 'exam_...' 접두사가 없는 순수한 ID입니다.
  const examIdToRemove = `seg_exam_${oldExamPlan.id}`;
  const examSegmentIndex = segments.findIndex((s) => s.id === examIdToRemove);

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
        if (nextBook) book.endUnitCode = nextBook.endUnitCode;
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
    let examPlans = (await kv.get(examPlanKey)) || [];

    if (req.method === "GET") {
      return res.status(200).json({ ok: true, examPlans });
    }

    const [allStudents, allClasses] = await getStudentAndClassData();
    const targetStudents = allStudents.filter(
      (s) => s.school === school && String(s.grade) === String(grade)
    );

    if (targetStudents.length === 0) {
      return res
        .status(404)
        .json({ ok: false, error: "해당 학생이 없습니다." });
    }

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

        // ▼▼▼ GPT 지적 사항 반영: 학생의 모든 플랜을 순회하며 수정합니다. ▼▼▼
        for (const plan of studentPlans) {
          if (!plan.planSegments) continue;
          const studentClass = allClasses.find(
            (c) => c.id === student.class_id
          );
          const classDefaultDays = studentClass?.schedule_days || "MON,WED,FRI";
          const studentScheduleDays =
            plan.planSegments.find((seg) => seg.days)?.days || classDefaultDays;

          plan.planSegments = processSegmentsAfterDeletion(
            plan.planSegments,
            planRecordToDelete,
            studentScheduleDays
          );
        }
        await kv.set(studentPlanKey, studentPlans);
      }

      const updatedExamPlans = examPlans.filter((p) => p.id !== examPlanId);
      await kv.set(examPlanKey, updatedExamPlans);
      return res.status(200).json({ ok: true });
    }

    // --- POST & PUT ---
    const [mainBook, vocaBook] = await Promise.all([
      readSheetObjects("mainBook"),
      readSheetObjects("vocaBook"),
    ]);

    // ▼▼▼ GPT 지적 사항 반영: ID 생성 방식을 통일합니다. ▼▼▼
    const isUpdate = req.method === "PUT";
    const newExamPlanId = isUpdate ? examPlanId : `exam_${Date.now()}`;
    const { planData } = req.body;

    for (const student of targetStudents) {
      const studentPlanKey = getStudentPlanKey(student.id);
      let studentPlans = (await kv.get(studentPlanKey)) || [];

      if (studentPlans.length === 0) {
        studentPlans.push({
          planId: `pln_${student.id}_${Date.now()}`,
          studentId: student.id,
          planSegments: [],
          userSkips: {},
        });
      }

      // ▼▼▼ GPT 지적 사항 반영: 학생의 모든 플랜을 순회하며 수정합니다. ▼▼▼
      for (const plan of studentPlans) {
        const studentClass = allClasses.find((c) => c.id === student.class_id);
        const classDefaultDays = studentClass?.schedule_days || "MON,WED,FRI";
        const studentScheduleDays =
          plan.planSegments?.find((seg) => seg.days)?.days || classDefaultDays;
        let currentSegments = plan.planSegments || [];

        if (isUpdate) {
          const planRecord = examPlans.find((p) => p.id === examPlanId);
          if (planRecord) {
            currentSegments = processSegmentsAfterDeletion(
              currentSegments,
              planRecord,
              studentScheduleDays
            );
          }
        }

        const newExamSegment = {
          ...planData,
          id: `seg_${newExamPlanId}`, // "seg_exam_..."가 아닌 "seg_..." + ID 형식
          days: studentScheduleDays,
        };

        const newExamStartUtc = toUtcDate(newExamSegment.startDate);
        const segmentsToInsertInto = [...currentSegments];
        currentSegments = [];

        for (const seg of segmentsToInsertInto) {
          const segStartUtc = toUtcDate(seg.startDate);
          const segEndUtc = toUtcDate(seg.endDate);

          if (segEndUtc < newExamStartUtc || segStartUtc >= newExamStartUtc) {
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
        plan.planSegments = currentSegments;
      }
      await kv.set(studentPlanKey, studentPlans);
    }

    if (isUpdate) {
      const planIndex = examPlans.findIndex((p) => p.id === examPlanId);
      if (planIndex > -1) {
        examPlans[planIndex] = {
          ...examPlans[planIndex],
          ...planData,
          id: examPlanId,
          updatedAt: new Date().toISOString(),
        };
      }
    } else {
      examPlans.push({ ...planData, id: newExamPlanId });
    }
    await kv.set(examPlanKey, examPlans);
    return res.status(isUpdate ? 200 : 201).json({ ok: true });
  } catch (e) {
    console.error(`[${req.method}] /api/exam-plans Error:`, e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
