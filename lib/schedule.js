// /lib/schedule.js — 최종 수정본 ('복귀' 생성 로직만 비활성화)

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

function buildQueueFactory(mainBook, vocaBook) {
  return function buildQueue(list, isVocab = false) {
    const getAll = (materialId) =>
      (isVocab ? vocaBook : mainBook)
        .filter((u) => String(u.material_id) === String(materialId))
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

    const out = [];
    (list || []).forEach((book, index) => {
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

      if (startIdx >= endIdx) return;

      const slicedUnits = all
        .slice(startIdx, endIdx)
        .map((unit) => ({ ...unit, instanceId: book.instanceId }));
      if (!slicedUnits.length) return;

      const firstUnitInSelection = slicedUnits[0];
      const isActuallyFirstUnitOfBook =
        String(all[0].unit_code).trim() ===
        String(firstUnitInSelection.unit_code).trim();

      if (!isVocab) {
        if (index > 0) {
          //  레인에서 첫번째 책이 아님
          if (isActuallyFirstUnitOfBook) {
            firstUnitInSelection.isOT = true;
          } else {
            // ▼▼▼ '복귀' 생성 로직 비활성화 ▼▼▼
            // out.push({
            //   isReturn: true,
            //   material_id: book.materialId,
            //   unit_code: "return-marker",
            //   instanceId: book.instanceId,
            // });
          }
        } else {
          // 레인에서 첫번째 책
          if (isActuallyFirstUnitOfBook) {
            firstUnitInSelection.isOT = true;
          } else {
            // ▼▼▼ '복귀' 생성 로직 비활성화 ▼▼▼
            // out.push({
            //   isReturn: true,
            //   material_id: book.materialId,
            //   unit_code: "return-marker",
            //   instanceId: book.instanceId,
            // });
          }
        }
      }
      out.push(...slicedUnits);
    });
    return out;
  };
}

// [신규] 진도 계산을 위한 별도 함수
export async function calculateProgress(body, preloadedData = null) {
  let mainBook, vocaBook;
  if (preloadedData) {
    mainBook = preloadedData.mainBook;
    vocaBook = preloadedData.vocaBook;
  } else {
    [mainBook, vocaBook] = await Promise.all([
      readSheetObjects("mainBook"),
      readSheetObjects("vocaBook").catch(() => []),
    ]);
  }

  const { startDate, endDate, days, lanes = {} } = body;
  if (!startDate || !endDate || !days) return [];

  const want = new Set(
    String(days)
      .split(",")
      .map((s) => s.trim().toUpperCase())
  );
  const calendar = [];
  for (
    let d = toUtcDate(startDate);
    d <= toUtcDate(endDate);
    d = addDays(d, 1)
  ) {
    if (want.has(DOW[d.getUTCDay()])) {
      calendar.push({ date: toYMD(d) });
    }
  }

  const makeQueue = buildQueueFactory(mainBook, vocaBook);
  const laneDef = {
    main1: makeQueue(lanes.main1 || [], false),
    main2: makeQueue(lanes.main2 || [], false),
    vocab: makeQueue(lanes.vocab || [], true),
  };
  const idx = { main1: 0, main2: 0, vocab: 0 };
  const items = [];

  for (const day of calendar) {
    for (const lane of ["main1", "main2", "vocab"]) {
      if (laneDef[lane][idx[lane]]) {
        items.push(laneDef[lane][idx[lane]]);
        idx[lane]++;
      }
    }
  }
  return items; // 실제 수업 아이템 목록 반환
}

export async function generatePlan(body, preloadedData = null) {
  const {
    startDate,
    endDate,
    days,
    lanes = {},
    userSkips = [],
    events = [],
    studentInfo = {},
  } = body;
  if (!startDate || !endDate || !days)
    throw new Error("startDate, endDate, days 누락");

  const want = new Set(
    String(days)
      .split(",")
      .map((s) => s.trim().toUpperCase())
  );
  const userSkipByDate = new Map(
    (userSkips || []).map((x) => [
      String(x.date || "").slice(0, 10),
      x.type === "vacation"
        ? "휴가"
        : x.type === "sick"
        ? "질병"
        : `기타: ${x.reason || ""}`.trim(),
    ])
  );

  let mainBook, vocaBook, holidays;
  if (preloadedData) {
    mainBook = preloadedData.mainBook || [];
    vocaBook = preloadedData.vocaBook || [];
    holidays = preloadedData.holidays || [];
  } else {
    [mainBook, vocaBook, holidays] = await Promise.all([
      readSheetObjects("mainBook"),
      readSheetObjects("vocaBook").catch(() => []),
      readSheetObjects("Holidays").catch(() => []),
    ]);
  }

  const holidayNameByDate = new Map(
    holidays.map((h) => [
      String(h.date || "").slice(0, 10),
      String(h.name || h.title || "공휴일").trim() || "공휴일",
    ])
  );
  const eventByDate = new Map();
  const sortedEvents = (events || []).sort((a, b) => {
    const rank = {
      all: 0,
      school: 1,
      grade: 2,
      school_grade: 3,
      class: 4,
      student: 5,
    };
    return (rank[b.scope] || 0) - (rank[a.scope] || 0);
  });
  for (const event of sortedEvents) {
    if (eventByDate.has(event.date)) continue;
    let match = false;
    if (event.scope === "all") match = true;
    else if (
      event.scope === "school" &&
      event.scopeValue === studentInfo.school
    )
      match = true;
    else if (
      event.scope === "grade" &&
      event.scopeValue === String(studentInfo.grade)
    )
      match = true;
    else if (
      event.scope === "school_grade" &&
      event.scopeValue === `${studentInfo.school}:${studentInfo.grade}`
    )
      match = true;
    else if (
      event.scope === "class" &&
      event.scopeValue === studentInfo.class_id
    )
      match = true;
    if (match) eventByDate.set(event.date, event);
  }

  const calendar = [];
  const processedDates = new Set();
  for (
    let d = toUtcDate(startDate);
    d <= toUtcDate(endDate);
    d = addDays(d, 1)
  ) {
    const y = toYMD(d);
    if (processedDates.has(y)) continue;
    const wd = DOW[d.getUTCDay()];
    const event = eventByDate.get(y);
    if (event?.type === "supplementary") {
      calendar.push({ date: y, weekday: wd, skipReason: null });
      processedDates.add(y);
      continue;
    }
    const userSkip = userSkipByDate.get(y);
    if (userSkip) {
      calendar.push({ date: y, weekday: wd, skipReason: userSkip });
      processedDates.add(y);
      continue;
    }
    if (event?.type === "event" && event?.applyTo === "all") {
      calendar.push({ date: y, weekday: wd, skipReason: event.title });
      processedDates.add(y);
      continue;
    }
    const fixedHoliday = fixedHolidayName(d);
    const namedHoliday = holidayNameByDate.get(y);
    if ((fixedHoliday || namedHoliday) && want.has(wd)) {
      calendar.push({
        date: y,
        weekday: wd,
        skipReason: `공휴일: ${fixedHoliday || namedHoliday}`,
      });
      processedDates.add(y);
      continue;
    }
    if (
      event?.type === "event" &&
      event?.applyTo === "attending" &&
      want.has(wd)
    ) {
      calendar.push({ date: y, weekday: wd, skipReason: event.title });
      processedDates.add(y);
      continue;
    }
    if (want.has(wd)) {
      calendar.push({ date: y, weekday: wd, skipReason: null });
      processedDates.add(y);
    }
  }
  calendar.sort((a, b) => a.date.localeCompare(b.date));

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
    for (const lane of ["main1", "main2", "vocab"]) {
      const u = laneDef[lane][idx[lane]];
      if (!u) continue;
      idx[lane]++;
      const base = {
        lane: lane,
        date: day.date,
        weekday: day.weekday,
        material_id: u.material_id,
        unit_code: u.unit_code,
        instanceId: u.instanceId,
      };
      if (lane === "vocab") {
        out.push({
          ...base,
          source: "vocab",
          lecture_range: u.lecture_range || u.lecture || "",
          vocab_range: u.vocab_range || "",
        });
      } else {
        out.push({
          ...base,
          source: "main",
          isOT: u.isOT || false,
          isReturn: u.isReturn || false,
          lecture_range: u.lecture_range || u.lecture || u.title || "",
          pages: u.pages || "",
          wb: u.wb || "",
          dt_vocab: u.dt_vocab || "",
          key_sents: u.key_sents || "",
        });
      }
    }
  }

  const rank = { main: 1, vocab: 2, skip: 9 };
  return out.sort((a, b) =>
    a.date < b.date
      ? -1
      : a.date > b.date
      ? 1
      : (rank[a.source] || 9) - (rank[b.source] || 9)
  );
}
