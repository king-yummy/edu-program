// server/schedule.js
const { readSheetObjects } = require("./sheets");

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const toYMD = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/**
 * 입력 body:
 * {
 *   studentId, startDate, days("MON,WED,FRI" 같은 CSV),
 *   main: { materialId, unitCodes: [] },
 *   vocabs: [{ materialId, unitCodes: [] }],
 *   options: { maxMainPerDay: 1|2, vocabMode: "paired"|"weekly_first"|"manual_only" }
 * }
 */
async function generatePlan(body) {
  const { startDate, days, main, vocabs = [], options = {} } = body;
  if (!startDate) throw new Error("startDate 누락");
  if (!days) throw new Error("days 누락");
  if (
    !main?.materialId ||
    !Array.isArray(main.unitCodes) ||
    main.unitCodes.length === 0
  )
    throw new Error("본교재 선택/차시 누락");

  const wanted = new Set(days.split(",").map((s) => s.trim().toUpperCase()));
  const maxMainPerDay = Number(options.maxMainPerDay || 1);
  const vocabMode = options.vocabMode || "paired";

  // 데이터 로드
  const [mainBook, vocaBook, holidays] = await Promise.all([
    readSheetObjects("mainBook"),
    readSheetObjects("vocaBook").catch(() => []),
    readSheetObjects("Holidays").catch(() => []),
  ]);
  const holidaySet = new Set(holidays.map((h) => String(h.date || "")));

  const mainUnits = mainBook
    .filter(
      (u) =>
        String(u.material_id) === String(main.materialId) &&
        main.unitCodes.includes(u.unit_code)
    )
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  const vocabPicksFlat = [];
  for (const v of vocabs) {
    const items = vocaBook
      .filter(
        (u) =>
          String(u.material_id) === String(v.materialId) &&
          v.unitCodes.includes(u.unit_code)
      )
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    vocabPicksFlat.push(...items);
  }

  // 날짜 확보 (충분히 넉넉하게)
  const needDays =
    Math.ceil(mainUnits.length / Math.max(1, maxMainPerDay)) +
    Math.ceil(vocabPicksFlat.length / 2) +
    12;
  const dates = [];
  let d = new Date(startDate);
  let guard = 0;
  while (dates.length < needDays && guard < 365 * 3) {
    const key = DOW[d.getDay()];
    const ymd = toYMD(d);
    if (wanted.has(key) && !holidaySet.has(ymd)) dates.push(new Date(d));
    d = addDays(d, 1);
    guard++;
  }

  // 본교재 우선 배정
  const plan = [];
  let di = 0,
    mi = 0;
  while (mi < mainUnits.length && di < dates.length) {
    const date = dates[di++];
    for (let k = 0; k < maxMainPerDay && mi < mainUnits.length; k++) {
      const u = mainUnits[mi++];
      plan.push({
        date: toYMD(date),
        weekday: DOW[date.getDay()],
        material_id: u.material_id,
        unit_code: u.unit_code,
        pages: u.pages || "",
        wb: u.wb || "",
        dt_vocab: u.dt_vocab || "",
        key_sents: u.key_sents || "",
        vocab_session: "",
        vocab_range: "",
        source: "auto",
      });
    }
  }

  // VOCAB 배정
  if (vocabMode === "paired" && vocabPicksFlat.length) {
    let vi = 0;
    for (let i = 0; i < plan.length && vi < vocabPicksFlat.length; i++) {
      const v = vocabPicksFlat[vi++];
      plan.push({
        date: plan[i].date,
        weekday: plan[i].weekday,
        material_id: v.material_id,
        unit_code: v.unit_code,
        pages: "",
        wb: "",
        dt_vocab: "",
        key_sents: "",
        vocab_session: v.vocab_session || "",
        vocab_range: v.vocab_range || "",
        source: "auto",
      });
    }
  } else if (vocabMode === "weekly_first" && vocabPicksFlat.length) {
    let vi = 0;
    const seen = new Set();
    for (const item of plan) {
      if (vi >= vocabPicksFlat.length) break;
      const d = new Date(item.date);
      // ISO 주차 계산 간단화: 연-월-주 키(대충 주별 1회)
      const wkKey = `${d.getFullYear()}-${d.getMonth() + 1}-${Math.floor(
        d.getDate() / 7
      )}`;
      if (!seen.has(wkKey)) {
        const v = vocabPicksFlat[vi++];
        seen.add(wkKey);
        plan.push({
          date: item.date,
          weekday: item.weekday,
          material_id: v.material_id,
          unit_code: v.unit_code,
          pages: "",
          wb: "",
          dt_vocab: "",
          key_sents: "",
          vocab_session: v.vocab_session || "",
          vocab_range: v.vocab_range || "",
          source: "auto",
        });
      }
    }
  }
  // manual_only 는 추가 배정 안 함

  // 본교재 먼저, 같은 날짜면 material_id/코드로 정렬
  return plan.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.material_id !== b.material_id)
      return String(a.material_id).localeCompare(String(b.material_id));
    return String(a.unit_code).localeCompare(String(b.unit_code));
  });
}

module.exports = { generatePlan };
