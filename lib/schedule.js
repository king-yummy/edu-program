// /lib/schedule.js — 최종 수정본

import { readSheetObjects } from "./sheets.js";

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const toUtcDate = (dateString) => {
  const [year, month, day] = dateString.split("T")[0].split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};
const toYMD = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

// 고정 공휴일
function fixedHolidayName(d) {
  const map = {
    "01-01": "신정",
    "03-01": "3·1절",
    "05-05": "어린이날",
    "06-06": "현충일",
    "08-15": "광복절",
    "10-03": "개천절",
    "10-09": "한글날",
    "12-25": "성탄절",
  };
  return map[toYMD(d).slice(5)] || null;
}

// OT 판단 로직이 포함된 큐 생성 함수
function buildQueueFactory(mainBook, vocaBook) {
  return function buildQueue(list, isVocab = false) {
    const getAll = (materialId) =>
      (isVocab ? vocaBook : mainBook)
        .filter((u) => String(u.material_id) === String(materialId))
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

    const out = [];
    (list || []).forEach((book) => {
      const all = getAll(book.materialId);
      if (!all.length) return;

      let startIdx = 0;
      if (book.startUnitCode) {
        const j = all.findIndex(
          (u) => String(u.unit_code) === String(book.startUnitCode)
        );
        startIdx = j >= 0 ? j : 0;
      }

      let endIdx = all.length;
      if (book.endUnitCode) {
        const j = all.findIndex(
          (u) => String(u.unit_code) === String(book.endUnitCode)
        );
        endIdx = j >= 0 ? j + 1 : all.length;
      }

      if (startIdx >= endIdx) {
        return;
      }

      const slicedUnits = all.slice(startIdx, endIdx);

      // [핵심 수정] 사용자가 선택한 시작 차시가 'order: 1'인 경우에만 OT로 판단
      if (!isVocab && slicedUnits.length > 0) {
        const firstUnitInSelection = slicedUnits[0];
        if (String(firstUnitInSelection.order || "").trim() === "1") {
          firstUnitInSelection.isOT = true;
        }
      }

      out.push(...slicedUnits);
    });
    return out;
  };
}

export async function generatePlan(body) {
  const {
    startDate,
    endDate,
    days,
    lanes = {},
    userSkips = [],
    tests = [],
  } = body;

  if (!startDate || !endDate || !days)
    throw new Error("startDate, endDate, days 누락");

  const want = new Set(
    String(days)
      .split(",")
      .map((s) => s.trim().toUpperCase())
  );
  const userSkipByDate = new Map(
    (userSkips || []).map((x) => {
      const d = String(x.date || "").slice(0, 10);
      const label =
        x.type === "vacation"
          ? "휴가"
          : x.type === "sick"
          ? "질병"
          : x.type === "other" && x.reason?.trim()
          ? `기타: ${x.reason.trim()}`
          : "기타";
      return [d, label];
    })
  );

  const [mainBook, vocaBook, holidays] = await Promise.all([
    readSheetObjects("mainBook"),
    readSheetObjects("vocaBook").catch(() => []),
    readSheetObjects("Holidays").catch(() => []),
  ]);

  const holidayNameByDate = new Map(
    holidays.map((h) => {
      const date = String(h.date || "").slice(0, 10);
      const name = String(h.name || h.title || "공휴일").trim() || "공휴일";
      return [date, name];
    })
  );

  const begin = toUtcDate(startDate);
  const end = toUtcDate(endDate);

  const calendar = [];
  for (let d = new Date(begin); d <= end; d = addDays(d, 1)) {
    const wd = DOW[d.getUTCDay()];
    const y = toYMD(d);
    if (!want.has(wd)) continue;

    const fixed = fixedHolidayName(d);
    const named = holidayNameByDate.get(y);
    const user = userSkipByDate.get(y);
    const skipReason = user || named || (fixed ? `공휴일: ${fixed}` : null);

    calendar.push({ date: y, weekday: wd, skipReason });
  }

  let testIndex = new Map();
  if (Array.isArray(tests) && tests.length) {
    for (const t of tests) {
      const d = String(t.date || "").slice(0, 10);
      if (!d) continue;
      if (!testIndex.has(d)) testIndex.set(d, []);
      testIndex.get(d).push({
        title: t.title || "Monthly Test",
        materialId: t.materialId || "",
        notes: t.notes || "",
      });
    }
  }

  for (const [d] of [...testIndex.entries()]) {
    const day = calendar.find((c) => c.date === d);
    if (!day || day.skipReason) {
      testIndex.delete(d);
    }
  }

  const makeQueue = buildQueueFactory(mainBook, vocaBook);
  const laneDef = {
    main1: makeQueue(lanes.main1 || [], false),
    main2: makeQueue(lanes.main2 || [], false),
    vocab: makeQueue(lanes.vocab || [], true),
  };
  const idx = { main1: 0, main2: 0, vocab: 0 };
  const out = [];

  for (const day of calendar) {
    if (day.skipReason) {
      out.push({
        date: day.date,
        weekday: day.weekday,
        source: "skip",
        reason: day.skipReason,
      });
      continue;
    }
    const todaysTests = testIndex.get(day.date) || [];
    if (todaysTests.length) {
      for (const t of todaysTests) {
        out.push({
          date: day.date,
          weekday: day.weekday,
          source: "test",
          title: t.title,
          material_id: t.materialId,
          notes: t.notes,
        });
      }
      continue;
    }
    for (const lane of ["main1", "main2", "vocab"]) {
      const q = laneDef[lane];
      const k = idx[lane];
      const u = q[k];
      if (!u) continue;
      idx[lane] = k + 1;
      if (lane === "vocab") {
        out.push({
          date: day.date,
          weekday: day.weekday,
          source: "vocab",
          material_id: u.material_id,
          unit_code: u.unit_code,
          lecture_range: u.lecture_range || u.lecture || "",
          vocab_range: u.vocab_range || "",
        });
      } else {
        out.push({
          date: day.date,
          weekday: day.weekday,
          source: "main",
          isOT: u.isOT || false,
          material_id: u.material_id,
          unit_code: u.unit_code,
          lecture_range: u.lecture_range || u.lecture || u.title || "",
          pages: u.pages || "",
          wb: u.wb || "",
          dt_vocab: u.dt_vocab || "",
          key_sents: u.key_sents || "",
        });
      }
    }
  }

  const rank = { test: 0, main: 1, vocab: 2, skip: 9 };
  return out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (rank[a.source] ?? 9) - (rank[b.source] ?? 9);
  });
}
