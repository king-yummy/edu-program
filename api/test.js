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
