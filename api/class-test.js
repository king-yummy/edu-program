// api/class-tests.js
import { getAllTests, putAllTests, isKvReady } from "../lib/kv.js";

// GET /api/class-tests?classId=CI&month=YYYY-MM
// POST /api/class-tests?classId=CI { date, title, materialId, notes }
export default async function handler(req, res) {
  const { classId, month } = req.query || {};
  if (!classId)
    return res.status(400).json({ ok: false, error: "classId required" });

  if (req.method === "GET") {
    const list = await getAllTests();
    const out = list.filter(
      (t) =>
        t.classId === classId &&
        (!month || (t.date || "").slice(0, 7) === month)
    );
    return res
      .status(200)
      .json({ ok: true, items: out, storage: isKvReady() ? "kv" : "memory" });
  }

  if (req.method === "POST") {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
    const { date, title, materialId = "", notes = "" } = body;
    if (!date || !title)
      return res
        .status(400)
        .json({ ok: false, error: "date & title required" });

    const list = await getAllTests();
    // 월 2회 제한
    const mm = (date || "").slice(0, 7);
    const count = list.filter(
      (t) => t.classId === classId && (t.date || "").slice(0, 7) === mm
    ).length;
    if (count >= 2)
      return res
        .status(400)
        .json({ ok: false, error: "max 2 tests per month" });

    const id = "T" + Math.random().toString(36).slice(2, 9);
    const rec = { id, classId, date, title, materialId, notes };

    if (!isKvReady())
      return res
        .status(501)
        .json({ ok: false, error: "KV not configured (set KV envs)" });
    list.push(rec);
    await putAllTests(list);
    return res.status(200).json({ ok: true, item: rec });
  }

  return res.status(405).json({ ok: false, error: "Method Not Allowed" });
}
