// api/materials.js
import { readSheetObjects } from "../lib/sheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const range = process.env.MATERIALS_RANGE || "Materials!A:Z";

  try {
    const rows = await readSheetObjects(range);
    // 표준화: { materialId, title, unit, key_sents }
    const out = rows.map((r, i) => ({
      materialId:
        r.materialId ?? r.MaterialId ?? r.ID ?? r.id ?? `MAT-${i + 1}`,
      title: r.title ?? r.Title ?? r.name ?? "",
      unit: r.unit ?? r.Unit ?? "",
      key_sents: r.key_sents ?? r.KeySents ?? "",
    }));

    // (선택) 캐시 힌트
    // res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

    return res.status(200).json(out);
  } catch (e) {
    // 초기 세팅 단계에선 404/500 대신 빈 배열 반환해도 OK
    return res.status(200).json([]);
  }
}
