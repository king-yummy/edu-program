// api/class.js
import { readSheetObjects } from "../lib/sheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }
  const RANGE = process.env.CLASSES_RANGE || "class!A:Z";
  try {
    const rows = await readSheetObjects(RANGE);
    const out = rows.map((r, i) => ({
      id: String(r.id || `C${i + 1}`),
      name: String(r.name || `Class ${i + 1}`),
      schedule_days: String(r.schedule_days || "MON,WED,FRI").toUpperCase(),
      test: String(r.test || ""), // 필요시 사용
    }));
    return res.status(200).json(out);
  } catch {
    return res.status(200).json([]);
  }
}
