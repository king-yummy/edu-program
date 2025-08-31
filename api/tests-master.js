// /api/tests-master.js — 신규 파일

import { readSheetObjects } from "../lib/sheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }
  // Vercel에 설정된 환경 변수를 사용합니다.
  const RANGE = process.env.TESTS_RANGE || "tests!A:Z";
  try {
    const rows = await readSheetObjects(RANGE);
    const out = rows.map((r, i) => ({
      id: String(r.id || `T${i + 1}`),
      name: String(r.name || ""),
    }));
    return res.status(200).json(out);
  } catch {
    return res.status(200).json([]);
  }
}
