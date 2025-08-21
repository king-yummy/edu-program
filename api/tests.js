// api/test.js
import { getAllTests, putAllTests, isKvReady } from "../lib/kv.js";

// PUT /api/test?id=T123 { date?, title?, materialId?, notes? }
// DELETE /api/test?id=T123
export default async function handler(req, res) {
  const { id } = req.query || {};
  if (!id) return res.status(400).json({ ok: false, error: "id required" });

  const list = await getAllTests();
  const i = list.findIndex((t) => t.id === id);
  if (i < 0)
    return res.status(404).json({ ok: false, error: "test not found" });

  if (req.method === "PUT") {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
    const next = { ...list[i], ...body };
    // 월당 2회 재검사(날짜가 바뀐다면)
    if (
      body.date &&
      body.date.slice(0, 7) !== (list[i].date || "").slice(0, 7)
    ) {
      const count = list.filter(
        (t) =>
          t.classId === next.classId &&
          (t.date || "").slice(0, 7) === body.date.slice(0, 7) &&
          t.id !== id
      ).length;
      if (count >= 2)
        return res
          .status(400)
          .json({ ok: false, error: "max 2 tests per month" });
    }
    if (!isKvReady())
      return res
        .status(501)
        .json({ ok: false, error: "KV not configured (set KV envs)" });
    list[i] = next;
    await putAllTests(list);
    return res.status(200).json({ ok: true, item: list[i] });
  }

  if (req.method === "DELETE") {
    if (!isKvReady())
      return res
        .status(501)
        .json({ ok: false, error: "KV not configured (set KV envs)" });
    list.splice(i, 1);
    await putAllTests(list);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ ok: false, error: "Method Not Allowed" });
}
