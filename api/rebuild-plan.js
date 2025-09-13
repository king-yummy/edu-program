// /api/rebuild-plan.js — 최종 수정본

// [수정] generatePlan 함수를 schedule.js에서 가져옵니다.
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
      // [추가] userSkips, events, studentInfo를 요청 본문에서 받아옵니다.
      // 이 값들이 프론트엔드에서 반드시 함께 전송되어야 합니다.
      userSkips = [],
      events = [],
      studentInfo = {},
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

      // ▼▼▼ [핵심 수정] A 구간의 실제 마지막 수업일을 계산하여 B 구간의 시작일을 조정합니다. ▼▼▼
      // generatePlan을 호출하여 A구간의 모든 비수업일(결석, 공휴일 등)을 반영한 플랜을 생성합니다.
      const partAItems = await generatePlan({
        ...partA,
        days: newDays, // 반드시 변경된 새 요일(newDays)을 사용해야 합니다.
        userSkips,
        events,
        studentInfo,
      });

      // 생성된 플랜에서 'skip'이 아닌, 실제 수업이 이루어진 마지막 날짜를 찾습니다.
      const lastTeachingItemInA = partAItems
        .filter((item) => item.source !== "skip")
        .pop();

      // B 구간의 새로운 시작 날짜를 계산합니다.
      // 만약 A 구간에 수업일이 있었다면, 그 마지막 수업일의 다음 날이 B 구간의 시작일이 됩니다.
      // A 구간에 수업일이 아예 없었다면(전체 결석 등), 기존처럼 내신 기간 종료일 다음 날로 설정합니다.
      let newPartBStartDate;
      if (lastTeachingItemInA && lastTeachingItemInA.date) {
        newPartBStartDate = toYMD(
          addDays(toUtcDate(lastTeachingItemInA.date), 1)
        );
      } else {
        newPartBStartDate = toYMD(addDays(toUtcDate(examSeg.endDate), 1));
      }

      // 만약 계산된 B구간 시작일이 내신 기간 종료일보다 이르다면, B구간 시작일을 내신 기간 종료일 다음날로 강제 조정합니다.
      if (toUtcDate(newPartBStartDate) <= toUtcDate(examSeg.endDate)) {
        newPartBStartDate = toYMD(addDays(toUtcDate(examSeg.endDate), 1));
      }
      // ▲▲▲ [핵심 수정] 여기까지 ▲▲▲

      // 서버에서 A 구간의 마지막 진도 단위를 정확히 계산
      const progressItems = await calculateProgress(
        { ...partA, days: newDays }, // 여기도 새 요일(newDays) 적용
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
        // [수정] 동적으로 계산된 새로운 시작일을 적용합니다.
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
