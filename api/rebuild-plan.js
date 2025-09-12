import { calculateProgress } from "../lib/schedule.js";
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
    } = req.body;

    // --- 1. 일반 교재만으로 새로운 기본 플랜 한 덩어리를 생성 ---
    const newBaseSegment = {
      id: `seg_${Date.now()}`,
      startDate: newStartDate,
      endDate: newEndDate,
      days: newDays,
      lanes: allRegularBooks,
    };

    let segmentsToProcess = [newBaseSegment];

    // --- 2. 진도 재계산을 위해 교재 마스터 데이터를 로드 ---
    const [mainBook, vocaBook] = await Promise.all([
      readSheetObjects("mainBook"),
      readSheetObjects("vocaBook").catch(() => []),
    ]);

    // --- 3. 내신 플랜을 하나씩 끼워넣으며 기본 플랜을 분할하고, 진도를 재계산 ---
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

      // A 구간 (내신 플랜 앞)
      const partA = {
        ...targetSeg,
        id: `${targetSeg.id}_a`,
        endDate: toYMD(addDays(toUtcDate(examSeg.startDate), -1)),
      };

      // 서버에서 A 구간의 마지막 진도 단위를 정확히 계산
      const progressItems = await calculateProgress(
        { ...partA },
        { mainBook, vocaBook }
      );
      const lastUnits = progressItems.reduce((acc, item) => {
        if (item.instanceId) acc[item.instanceId] = item.unit_code;
        return acc;
      }, {});

      // 계산된 마지막 진도를 바탕으로 B 구간의 시작 진도를 재설정
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

      // B 구간 (내신 플랜 뒤)
      const partB = {
        ...targetSeg,
        id: `${targetSeg.id}_b`,
        startDate: toYMD(addDays(toUtcDate(examSeg.endDate), 1)),
        lanes: partB_lanes,
      };

      // ▼▼▼ [요일 문제 해결] 내신 플랜에도 새로운 요일을 적용! ▼▼▼
      const updatedExamSeg = { ...examSeg, days: newDays };

      const newParts = [];
      if (toUtcDate(partA.startDate) <= toUtcDate(partA.endDate))
        newParts.push(partA);
      newParts.push(updatedExamSeg); // 새 요일이 적용된 내신 플랜 삽입
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
