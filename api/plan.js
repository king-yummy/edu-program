// api/plan.js
import { generatePlan } from "../lib/schedule.js";
import { getAllTests } from "../lib/kv.js";

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const toYMD = (d) => {
  const x = new Date(d);
  if (Number.isNaN(x)) return "";
  return x.toISOString().slice(0, 10);
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  let body = {};
  try {
    body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON body" });
  }

  const {
    // 공통
    classId = "",

    // A형 입력 (schedule.js 최신 버전 권장 입력)
    startDate,
    endDate, // 선택 (없으면 weeks로 계산)
    days, // "MON,WED,FRI" 형태 (없으면 daysOfWeek로 계산)

    // B형 입력(구형 호환)
    weeks, // 숫자 (없으면 기본 4주)
    daysOfWeek, // [1,3,5] 숫자 배열

    // 기타
    lanes = {},
    userSkips = [],
    exceptions, // 구형 호환: userSkips와 합침
    tests: testsFromBody = [], // 명시적 시험 목록(없으면 KV/auto)
    testMode, // "explicit" | "auto"
  } = body;

  if (!startDate) {
    return res
      .status(400)
      .json({ ok: false, error: "startDate required (YYYY-MM-DD)" });
  }

  // days 정규화
  let daysStr = typeof days === "string" && days ? days.toUpperCase() : "";
  if (!daysStr && Array.isArray(daysOfWeek) && daysOfWeek.length) {
    daysStr = daysOfWeek.map((i) => DOW[Number(i) || 0]).join(",");
  }
  if (!daysStr) daysStr = "MON,WED,FRI";

  // endDate 없으면 weeks로 계산
  let end = endDate;
  if (!end) {
    const w = Number.isFinite(Number(weeks)) ? Number(weeks) : 4;
    const s = new Date(startDate);
    s.setDate(s.getDate() + w * 7 - 1);
    end = toYMD(s);
  }

  // userSkips(신) + exceptions(구) 병합
  const skips = Array.isArray(userSkips) ? userSkips : [];
  if (Array.isArray(exceptions)) skips.push(...exceptions);

  // 시험 수집: (1) KV → classId 필터 (2) body.tests가 있으면 우선
  let tests = [];
  try {
    const all = await getAllTests(); // KV 미설정이면 [] 반환하도록 구현돼 있음
    if (Array.isArray(all))
      tests = all.filter((t) => String(t.classId) === String(classId));
  } catch {
    /* ignore */
  }
  if (Array.isArray(testsFromBody) && testsFromBody.length) {
    tests = testsFromBody; // 명시 입력이 있으면 우선
  }

  // 시험 모드: 명시 시험이 있으면 explicit, 없으면 auto(월 마지막/마이너스2 월요일)
  const resolvedTestMode = tests.length
    ? testMode || "explicit"
    : testMode || "auto";

  try {
    // 🔴 generatePlan은 async이므로 반드시 await
    const items = await generatePlan({
      startDate,
      endDate: end,
      days: daysStr,
      lanes,
      userSkips: skips,
      tests,
      testMode: resolvedTestMode,
    });
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || "plan failed" });
  }
}
