// api/materials.js (핵심 필드 보장)
import { readSheetObjects } from "../lib/sheets.js";
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }
  const range = process.env.MATERIALS_RANGE || "material!A:Z"; // 탭명 맞춤
  try {
    const rows = await readSheetObjects(range);
    const out = rows.map((r, i) => ({
      material_id: String(r.material_id ?? r.id ?? `MAT-${i + 1}`),
      type: String(r.type || "MAIN").toUpperCase(), // MAIN/VOCAB
      title: String(r.title ?? r.name ?? ""),
    }));
    return res.status(200).json(out);
  } catch {
    return res.status(200).json([]);
  }
}
