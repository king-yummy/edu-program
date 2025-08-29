// /api/mainBook.js

import { readSheetObjects } from "../lib/sheets.js";

export default async function handler(req, res) {
  try {
    const rows = await readSheetObjects("mainBook");
    const { materialId } = req.query;

    const sorted = rows.sort(
      (a, b) => Number(a.order || 0) - Number(b.order || 0)
    );

    const filtered = materialId
      ? sorted.filter((r) => r.material_id === materialId)
      : sorted;

    return res.status(200).json(filtered);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "mainBook 시트 읽기 실패" });
  }
}
