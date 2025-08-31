// api/class-tests.js
import { getAllTests, putAllTests, isKvReady } from "../lib/kv.js";

export default async function handler(req, res) {
  const { classId, month } = req.query || {};
  if (!classId)
    return res.status(400).json({ ok: false, error: "classId required" });

  if (req.method === "GET") {
    const all = await getAllTests();
    const items = all
      .filter((t) => String(t.classId) === String(classId))
      .filter((t) => !month || String(t.date).slice(0, 7) === String(month));
    return res
      .status(200)
      .json({ ok: true, items, storage: isKvReady() ? "kv" : "memory" });
  }

  if (req.method === "POST") {
    if (!isKvReady())
      return res.status(501).json({ ok: false, error: "KV not configured" });
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
    const { date, title, materialId = "", notes = "" } = body;
    if (!date || !title)
      return res
        .status(400)
        .json({ ok: false, error: "date & title required" });

    const all = await getAllTests();

    const item = {
      id: "T" + Math.random().toString(36).slice(2, 9),
      classId: String(classId),
      date,
      title,
      materialId,
      notes,
    };
    all.push(item);
    await putAllTests(all);
    return res.status(200).json({ ok: true, item });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "Method Not Allowed" });
}
