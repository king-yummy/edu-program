// api/plan.js
import { generatePlan } from "../lib/schedule.js";
import { getAllTests } from "../lib/kv.js";

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  const body =
    typeof req.body === "string"
      ? JSON.parse(req.body || "{}")
      : req.body || {};
  const {
    classId = "",
    startDate,
    weeks = 4,
    daysOfWeek = [1, 3, 5],
    lanes = {},
    exceptions = {},
  } = body;
  if (!startDate)
    return res
      .status(400)
      .json({ ok: false, error: "startDate required (YYYY-MM-DD)" });

  // 시험 주입 (스토리지 없으면 빈 배열)
  const allTests = await getAllTests();
  const tests = allTests.filter((t) => t.classId === classId);

  const items = generatePlan({
    startDate,
    weeks,
    daysOfWeek,
    lanes,
    exceptions,
    tests,
  });
  return res.status(200).json({ ok: true, items });
}
