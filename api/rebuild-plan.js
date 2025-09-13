// /api/rebuild-plan.js — 최종 수정본

import { calculateProgress, generatePlan } from "../lib/schedule.js";
import { readSheetObjects } from "../lib/sheets.js";

// --- 날짜 계산 Helper 함수들 ---
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

// --- API 핸들러 ---
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const {
      newStartDate,
      newEndDate,
      newDays,
      allRegularBooks,
      fixedExamSegments,
      userSkips = [],
      events = [],
      studentInfo = {},
    } = req.body;

    const newBaseSegment = {
      id: `seg_${Date.now()}`,
      startDate: newStartDate,
      endDate: newEndDate,
      days: newDays,
      lanes: allRegularBooks,
    };

    let segmentsToProcess = [newBaseSegment];

    const [mainBook, vocaBook] = await Promise.all([
      readSheetObjects("mainBook"),
      readSheetObjects("vocaBook").catch(() => []),
    ]);

    for (const examSeg of fixedExamSegments.sort((a, b) =>
      a.startDate.localeCompare(b.startDate)
    )) {
      const targetIndex = segmentsToProcess.findIndex(
        (seg) =>
          !seg.id.startsWith("seg_exam_") &&
          toUtcDate(examSeg.startDate) >= toUtcDate(seg.startDate) &&
          toUtcDate(examSeg.startDate) <= toUtcDate(seg.endDate)
      );

      if (targetIndex === -1) continue;

      const targetSeg = segmentsToProcess[targetIndex];

      const partA = {
        ...targetSeg,
        id: `${targetSeg.id}_a`,
        endDate: toYMD(addDays(toUtcDate(examSeg.startDate), -1)),
      };

      const partAItems = await generatePlan({
        ...partA,
        days: newDays,
        userSkips,
        events,
        studentInfo,
      });

      const lastTeachingItemInA = partAItems
        .filter((item) => item.source !== "skip")
        .pop();

      let newPartBStartDate = lastTeachingItemInA
        ? toYMD(addDays(toUtcDate(lastTeachingItemInA.date), 1))
        : toYMD(addDays(toUtcDate(examSeg.endDate), 1));

      if (toUtcDate(newPartBStartDate) <= toUtcDate(examSeg.endDate)) {
        newPartBStartDate = toYMD(addDays(toUtcDate(examSeg.endDate), 1));
      }

      // ▼▼▼ [핵심 수정] calculateProgress에 모든 관련 정보를 전달합니다. ▼▼▼
      const progressItems = await calculateProgress(
        {
          ...partA,
          days: newDays,
          userSkips,
          events,
          studentInfo,
        },
        { mainBook, vocaBook }
      );
      // ▲▲▲ [핵심 수정] 여기까지 ▲▲▲

      const lastUnits = progressItems.reduce((acc, item) => {
        if (item.instanceId) acc[item.instanceId] = item.unit_code;
        return acc;
      }, {});

      const partB_lanes = JSON.parse(JSON.stringify(targetSeg.lanes));
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
        ...targetSeg,
        id: `${targetSeg.id}_b`,
        startDate: newPartBStartDate,
        lanes: partB_lanes,
      };

      const updatedExamSeg = { ...examSeg, days: newDays };

      const newParts = [];
      if (toUtcDate(partA.startDate) <= toUtcDate(partA.endDate))
        newParts.push(partA);
      newParts.push(updatedExamSeg);
      if (toUtcDate(partB.startDate) <= toUtcDate(partB.endDate))
        newParts.push(partB);

      segmentsToProcess.splice(targetIndex, 1, ...newParts);
    }

    return res
      .status(200)
      .json({ ok: true, newPlanSegments: segmentsToProcess });
  } catch (e) {
    console.error("Plan rebuild error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
