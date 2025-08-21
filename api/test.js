// api/test.js
import { getAllTests, putAllTests, isKvReady } from "../lib/kv.js";

export default async function handler(req, res) {
  const { id } = req.query || {};
  if (!id) return res.status(400).json({ ok: false, error: "id required" });

  const all = await getAllTests();
  const i = all.findIndex((t) => t.id === id);
  if (i < 0)
    return res.status(404).json({ ok: false, error: "test not found" });

  if (req.method === "PUT") {
    if (!isKvReady())
      return res.status(501).json({ ok: false, error: "KV not configured" });
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
    const next = { ...all[i], ...body };

    // 월 2회 제한 재검사(날짜 바뀔 때)
    if (
      body.date &&
      String(body.date).slice(0, 7) !== String(all[i].date).slice(0, 7)
    ) {
      const mm = String(body.date).slice(0, 7);
      const cnt = all.filter(
        (t) =>
          t.classId === next.classId &&
          String(t.date).slice(0, 7) === mm &&
          t.id !== id
      ).length;
      if (cnt >= 2)
        return res
          .status(400)
          .json({ ok: false, error: "max 2 tests per month" });
    }
    all[i] = next;
    await putAllTests(all);
    return res.status(200).json({ ok: true, item: all[i] });
  }

  if (req.method === "DELETE") {
    if (!isKvReady())
      return res.status(501).json({ ok: false, error: "KV not configured" });
    all.splice(i, 1);
    await putAllTests(all);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "PUT, DELETE");
  return res.status(405).json({ ok: false, error: "Method Not Allowed" });
}
