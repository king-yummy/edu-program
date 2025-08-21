// api/class.js
import { readSheetObjects } from "../lib/sheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  const range = process.env.CLASSES_RANGE || "Classes!A:Z";
  try {
    const rows = await readSheetObjects(range);
    // 컬럼 표준화 예시: { id, name, students, level }
    const out = rows.map((r, i) => ({
      id: r.id || r.ID || `C${i + 1}`,
      name: r.name || r.class || r.Class || `Class ${i + 1}`,
      students: (r.students || r.Students || "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      level: r.level || r.Level || "",
    }));
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json([]); // 시트 미설정이어도 404 대신 빈 배열
  }
}
