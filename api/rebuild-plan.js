import { calculateProgress } from "../lib/schedule.js";
import { readSheetObjects } from "../lib/sheets.js";

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
      readSheetObjects("vocaBook"),
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

      // A구간의 마지막 진도를 서버에서 정확히 계산
      const progressItems = await calculateProgress(
        { ...partA },
        { mainBook, vocaBook }
      );
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
            if (!lastUnitCode) return book; // A 구간에 없던 책은 그대로 둠

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
            return null; // A 구간에서 책이 끝났으면 B 구간에선 제외
          })
          .filter(Boolean);
      }

      const partB = {
        ...targetSeg,
        id: `${targetSeg.id}_b`,
        startDate: toYMD(addDays(toUtcDate(examSeg.endDate), 1)),
        lanes: partB_lanes,
      };

      const newParts = [];
      if (toUtcDate(partA.startDate) <= toUtcDate(partA.endDate))
        newParts.push(partA);
      newParts.push(examSeg);
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
