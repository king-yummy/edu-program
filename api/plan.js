// /api/plan.js — 전체 교체

import { generatePlan } from "../lib/schedule.js";
import { getAllTests } from "../lib/kv.js";

const toYMD = (d) => {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
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
    classId = "",
    startDate,
    endDate,
    days,
    lanes = {},
    userSkips = [],
  } = body;

  if (!startDate) {
    return res
      .status(400)
      .json({ ok: false, error: "startDate required (YYYY-MM-DD)" });
  }
  if (!endDate) {
    return res
      .status(400)
      .json({ ok: false, error: "endDate required (YYYY-MM-DD)" });
  }

  // [핵심 변경] 프론트엔드에서 받은 시험 정보(testsFromBody)를 무시하고,
  // 서버(KV 저장소)에서 직접 모든 시험 정보를 가져온 뒤, 플랜 기간으로 필터링합니다.
  let testsInRange = [];
  try {
    const allTests = await getAllTests();
    if (Array.isArray(allTests)) {
      testsInRange = allTests
        .filter((t) => String(t.classId) === String(classId))
        .filter((t) => {
          const testDate = toYMD(t.date);
          return testDate >= toYMD(startDate) && testDate <= toYMD(endDate);
        });
    }
  } catch {
    // KV 조회 실패 시 무시
  }

  try {
    const items = await generatePlan({
      startDate,
      endDate,
      days:
        typeof days === "string" && days ? days.toUpperCase() : "MON,WED,FRI",
      lanes,
      userSkips,
      tests: testsInRange, // [핵심 변경] 기간에 맞는 시험 정보만 전달
    });
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e.message || "plan failed" });
  }
}
