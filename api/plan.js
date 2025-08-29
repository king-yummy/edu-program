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

    // A형 입력
    startDate,
    endDate,
    days,

    // B형 입력(구형 호환)
    weeks,
    daysOfWeek,

    // 기타
    lanes = {},
    userSkips = [],
    exceptions,
    tests: testsFromBody = [],
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

  const skips = Array.isArray(userSkips) ? userSkips : [];
  if (Array.isArray(exceptions)) skips.push(...exceptions);

  let tests = [];
  try {
    const all = await getAllTests();
    if (Array.isArray(all))
      tests = all.filter((t) => String(t.classId) === String(classId));
  } catch {
    /* ignore */
  }
  if (Array.isArray(testsFromBody) && testsFromBody.length) {
    tests = testsFromBody;
  }

  try {
    const items = await generatePlan({
      startDate,
      endDate: end,
      days: daysStr,
      lanes,
      userSkips: skips,
      tests,
      testMode: "explicit", // 항상 explicit 모드로 고정
    });
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || "plan failed" });
  }
}
