// /api/tests-master.js — 신규 파일

import { readSheetObjects } from "../lib/sheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }
  const RANGE = process.env.TESTS_RANGE || "tests!A:Z";
  try {
    const rows = await readSheetObjects(RANGE);
    const out = rows.map((r, i) => ({
      id: String(r.id || `T${i + 1}`),
      name: String(r.name || ""),
    }));
    return res.status(200).json(out);
  } catch (e) {
    // 에러 발생 시 빈 배열 대신 에러 메시지를 반환하여 원인 파악을 돕습니다.
    console.error(e);
    return res.status(500).json({ error: "tests 시트 읽기 실패" });
  }
}
