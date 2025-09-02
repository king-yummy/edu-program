// /lib/schedule.js — 수정본

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
  // ... (기존과 동일, 변경 없음)
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

      const slicedUnits = all.slice(startIdx, endIdx);
      if (!slicedUnits.length) return;

      const firstUnitInSelection = slicedUnits[0];

      if (!isVocab) {
        if (index > 0) {
          if (String(firstUnitInSelection.order || "").trim() === "1") {
            firstUnitInSelection.isOT = true;
          } else {
            const returnMarker = {
              isReturn: true,
              material_id: book.materialId,
              unit_code: "return-marker",
            };
            out.push(returnMarker);
          }
        } else {
          if (String(firstUnitInSelection.order || "").trim() === "1") {
            firstUnitInSelection.isOT = true;
          }
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

  // [수정] 이벤트 필터링 로직 강화
  const eventByDate = new Map();
  // 우선순위: student > class > school_grade > grade > school > all
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
    if (eventByDate.has(event.date)) continue; // 이미 더 높은 우선순위의 이벤트가 등록됨

    let match = false;
    if (event.scope === "all") {
      match = true;
    } else if (
      event.scope === "school" &&
      event.scopeValue === studentInfo.school
    ) {
      match = true;
    } else if (
      event.scope === "grade" &&
      event.scopeValue === String(studentInfo.grade)
    ) {
      match = true;
    } else if (
      event.scope === "school_grade" &&
      event.scopeValue === `${studentInfo.school}:${studentInfo.grade}`
    ) {
      match = true;
    } else if (
      event.scope === "class" &&
      event.scopeValue === studentInfo.class_id
    ) {
      match = true;
    }

    if (match) {
      eventByDate.set(event.date, event);
    }
  }

  const begin = toUtcDate(startDate);
  const end = toUtcDate(endDate);
  const calendar = [];
  const processedDates = new Set(); // [추가] 날짜 중복 처리 방지

  // [수정] 캘린더 생성 로직 전체 변경
  for (let d = new Date(begin); d <= end; d = addDays(d, 1)) {
    const y = toYMD(d);
    if (processedDates.has(y)) continue;

    const wd = DOW[d.getUTCDay()];
    const event = eventByDate.get(y);

    // 우선순위 1: 보강 수업 (모든 휴일/이벤트 무시)
    if (event?.type === "supplementary") {
      calendar.push({ date: y, weekday: wd, skipReason: null });
      processedDates.add(y);
      continue;
    }

    // 우선순위 2: 개인 결석
    const userSkip = userSkipByDate.get(y);
    if (userSkip) {
      calendar.push({ date: y, weekday: wd, skipReason: userSkip });
      processedDates.add(y);
      continue;
    }

    // 우선순위 3: '모든 학생' 적용 이벤트
    if (event?.type === "event" && event?.applyTo === "all") {
      calendar.push({ date: y, weekday: wd, skipReason: event.title });
      processedDates.add(y);
      continue;
    }

    // 우선순위 4: 공휴일 (고정/대체)
    const fixedHoliday = fixedHolidayName(d);
    const namedHoliday = holidayNameByDate.get(y);
    if (fixedHoliday || namedHoliday) {
      // 공휴일이지만, 학생의 수업일이 아니면 굳이 캘린더에 표시하지 않음
      if (want.has(wd)) {
        calendar.push({
          date: y,
          weekday: wd,
          skipReason: fixedHoliday ? `공휴일: ${fixedHoliday}` : namedHoliday,
        });
        processedDates.add(y);
      }
      continue;
    }

    // 우선순위 5: '출석 학생' 적용 이벤트
    if (
      event?.type === "event" &&
      event?.applyTo === "attending" &&
      want.has(wd)
    ) {
      calendar.push({ date: y, weekday: wd, skipReason: event.title });
      processedDates.add(y);
      continue;
    }

    // 우선순위 6: 일반 수업일
    if (want.has(wd)) {
      calendar.push({ date: y, weekday: wd, skipReason: null });
      processedDates.add(y);
    }
  }

  // 날짜순으로 정렬
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
      const q = laneDef[lane];
      const k = idx[lane];
      const u = q[k];
      if (!u) continue;
      idx[lane] = k + 1;

      const base = {
        lane: lane,
        date: day.date,
        weekday: day.weekday,
        material_id: u.material_id,
        unit_code: u.unit_code,
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
  return out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (rank[a.source] ?? 9) - (rank[b.source] ?? 9);
  });
}
