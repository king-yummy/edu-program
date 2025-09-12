// /api/rebuild-plan.js

import { calculateProgress } from "../lib/schedule.js";
import { readSheetObjects } from "../lib/sheets.js";

// toUtcDate, toYMD, addDays는 schedule.js에서 가져와도 되지만,
// 독립적인 작동을 위해 여기에 복사해 둡니다.
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
      allRegularBooks, // 교재 정보 (시작/종료 차시 포함)
      fixedExamSegments, // 고정되어야 할 내신/삽입 기간 목록
    } = req.body;

    // 1. 전체 기간을 대표하는 기본 일반 플랜 구간을 만듭니다.
    const baseSegment = {
      id: `seg_base_${Date.now()}`,
      startDate: newStartDate,
      endDate: newEndDate,
      days: newDays,
      lanes: allRegularBooks,
    };

    let segmentsToProcess = [baseSegment];
    const [mainBook, vocaBook] = await Promise.all([
      readSheetObjects("mainBook"),
      readSheetObjects("vocaBook"),
    ]);

    // 2. 고정된 내신 기간들을 날짜순으로 정렬하여 순차적으로 끼워넣습니다.
    const sortedFixedSegments = fixedExamSegments.sort((a, b) =>
      a.startDate.localeCompare(b.startDate)
    );

    for (const examSeg of sortedFixedSegments) {
      // 내신 기간이 포함될 일반 플랜 구간을 찾습니다.
      const targetIndex = segmentsToProcess.findIndex(
        (seg) =>
          !seg.id.startsWith("seg_exam_") &&
          !seg.id.includes("_insertion") &&
          toUtcDate(examSeg.startDate) >= toUtcDate(seg.startDate) &&
          toUtcDate(examSeg.startDate) <= toUtcDate(seg.endDate)
      );

      // 대상 구간이 없으면 다음 내신 기간으로 넘어갑니다.
      if (targetIndex === -1) continue;

      const targetSeg = segmentsToProcess[targetIndex];

      // 3. 대상 구간을 내신 기간 기준으로 세 조각으로 나눕니다.
      //    A: 내신 시작 전 / B: 내신 기간 / C: 내신 종료 후

      // Part A: 내신 시작 전 구간
      const partA = {
        ...targetSeg,
        id: `${targetSeg.id}_partA_${examSeg.id}`,
        endDate: toYMD(addDays(toUtcDate(examSeg.startDate), -1)),
      };

      // 4. A 구간의 최종 진도를 서버에서 정확하게 다시 계산합니다.
      //    이 진도가 C 구간의 시작 진도가 됩니다.
      const progressItems = await calculateProgress(
        { ...partA },
        { mainBook, vocaBook }
      );

      const lastUnits = progressItems.reduce((acc, item) => {
        // instanceId를 키로 마지막 unit_code를 저장합니다.
        if (item.instanceId) {
          acc[item.instanceId] = item.unit_code;
        }
        return acc;
      }, {});

      // 5. C 구간에 들어갈 교재들의 시작 차시를 A의 마지막 진도 다음으로 설정합니다.
      const partC_lanes = JSON.parse(JSON.stringify(targetSeg.lanes));
      const allBookUnits = [...mainBook, ...vocaBook];

      for (const lane in partC_lanes) {
        partC_lanes[lane] = partC_lanes[lane]
          .map((book) => {
            const lastUnitCode = lastUnits[book.instanceId];
            if (!lastUnitCode) {
              // A 구간에 없던 책(예: C 구간에 새로 추가된 책)은 그대로 둡니다.
              return book;
            }

            const bookUnits = allBookUnits
              .filter((u) => u.material_id === book.materialId)
              .sort((a, b) => Number(a.order) - Number(b.order));
            const lastUnitIdx = bookUnits.findIndex(
              (u) => u.unit_code === lastUnitCode
            );

            // A 구간에서 책의 진도가 끝났으면 C 구간에서는 이 책을 제외합니다.
            if (lastUnitIdx === -1 || lastUnitIdx + 1 >= bookUnits.length) {
              return null;
            }

            // A 구간 다음 차시를 C 구간의 시작 차시로 설정합니다.
            return {
              ...book,
              startUnitCode: bookUnits[lastUnitIdx + 1].unit_code,
            };
          })
          .filter(Boolean); // null로 표시된(진도가 끝난) 책들을 배열에서 제거합니다.
      }

      // Part C: 내신 종료 후 구간
      const partC = {
        ...targetSeg,
        id: `${targetSeg.id}_partC_${examSeg.id}`,
        startDate: toYMD(addDays(toUtcDate(examSeg.endDate), 1)),
        lanes: partC_lanes,
      };

      // 6. 기존 구간을 새로운 A, B, C 세 조각으로 교체합니다.
      const newParts = [];
      // 각 구간의 시작일이 종료일보다 늦으면 (즉, 기간이 없으면) 추가하지 않습니다.
      if (toUtcDate(partA.startDate) <= toUtcDate(partA.endDate)) {
        newParts.push(partA);
      }
      newParts.push(examSeg); // Part B (내신 기간 자체)
      if (toUtcDate(partC.startDate) <= toUtcDate(partC.endDate)) {
        newParts.push(partC);
      }

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
