// /api/plan.js — 최종 수정본

import { generatePlan } from "../lib/schedule.js";
// [수정] 기존 tests 로직 대신 새로운 events 로직을 불러옵니다.
import { getEvents } from "../lib/kv.js";

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

  // [수정] studentInfo를 받고, 불필요한 classId는 제거합니다.
  const {
    startDate,
    endDate,
    days,
    lanes = {},
    userSkips = [],
    studentInfo = {}, // 학생 정보
  } = body;

  if (!startDate || !endDate) {
    return res
      .status(400)
      .json({ ok: false, error: "startDate와 endDate가 필요합니다." });
  }

  try {
    // [수정] 모든 이벤트를 가져옵니다.
    const allEvents = await getEvents();

    // [수정] generatePlan 함수에 events와 studentInfo를 전달합니다.
    const items = await generatePlan({
      startDate,
      endDate,
      days:
        typeof days === "string" && days ? days.toUpperCase() : "MON,WED,FRI",
      lanes,
      userSkips,
      events: allEvents,
      studentInfo,
    });
    return res.status(200).json({ ok: true, items });
  } catch (e) {
    console.error("플랜 생성 실패:", e);
    return res
      .status(500)
      .json({ ok: false, error: e.message || "plan generation failed" });
  }
}
