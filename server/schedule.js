// server/schedule.js
const { readSheetObjects } = require("./sheets");

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const toYMD = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
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

async function generatePlan(body) {
  const {
    studentName,
    startDate,
    endDate,
    days,
    lanes = {},
    userSkips = [],
  } = body;
  if (!startDate) throw new Error("startDate 누락");
  if (!endDate) throw new Error("endDate 누락");
  if (!days) throw new Error("days 누락");

  const want = new Set(days.split(",").map((s) => s.trim().toUpperCase()));

  // ⬇️ 사용자 지정 스킵 맵 (date -> label)
  const userSkipByDate = new Map(
    (userSkips || []).map((x) => {
      const d = String(x.date || "").slice(0, 10);
      const label =
        x.type === "vacation"
          ? "휴가"
          : x.type === "sick"
          ? "질병"
          : x.type === "other"
          ? x.reason?.trim()
            ? `기타: ${x.reason.trim()}`
            : "기타"
          : x.reason?.trim() || "기타";
      return [d, label];
    })
  );

  // 시트 로드
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

  // 헬퍼: 책 → 단원 큐 만들기
  const buildQueue = (list, isVocab = false) => {
    const getAll = (materialId) =>
      (isVocab ? vocaBook : mainBook)
        .filter((u) => String(u.material_id) === String(materialId))
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    const out = [];
    list.forEach((book, i) => {
      const all = getAll(book.materialId);
      if (!all.length) return;
      let startIdx = 0;
      if (i === 0 && book.startUnitCode) {
        const j = all.findIndex(
          (u) => String(u.unit_code) === String(book.startUnitCode)
        );
        startIdx = j >= 0 ? j : 0;
      }
      out.push(...all.slice(startIdx));
    });
    return out;
  };

  const laneDef = {
    main1: buildQueue(lanes.main1 || [], false),
    main2: buildQueue(lanes.main2 || [], false),
    vocab: buildQueue(lanes.vocab || [], true),
  };

  // 캘린더(시작~끝)
  const begin = new Date(startDate),
    end = new Date(endDate);
  const calendar = [];
  for (let d = new Date(begin); d <= end; d = addDays(d, 1)) {
    const wd = DOW[d.getDay()],
      y = toYMD(d);
    if (!want.has(wd)) continue;

    // ⬇️ 공휴일 이름
    const fixed = fixedHolidayName(d);
    const named = holidayNameByDate.get(y);

    // ⬇️ 사용자 지정 스킵이 최우선, 없으면 공휴일
    const user = userSkipByDate.get(y);
    const skipReason = user || named || (fixed ? `공휴일: ${fixed}` : null);

    calendar.push({ date: y, weekday: wd, skipReason });
  }

  // 배정: 날짜당 main1 1단원, main2 1단원, vocab 1세션씩
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
      if (lane === "vocab") {
        out.push({
          date: day.date,
          weekday: day.weekday,
          source: "vocab",
          material_id: u.material_id,
          unit_code: u.unit_code,
          lecture_range: u.lecture_range || u.lecture || "",
          pages: "",
          wb: "",
          dt_vocab: "",
          key_sents: "",
          vocab_session: u.vocab_session || "",
          vocab_range: u.vocab_range || "",
        });
      } else {
        out.push({
          date: day.date,
          weekday: day.weekday,
          source: "main",
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

  return out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const rank = { skip: 0, main: 1, vocab: 2 };
    return (rank[a.source] ?? 9) - (rank[b.source] ?? 9);
  });
}

module.exports = { generatePlan };
