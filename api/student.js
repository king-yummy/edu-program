// /api/student.js — 수정본
import { readSheetObjects } from "../lib/sheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }

  // [수정] classId 필터링 로직 제거
  try {
    const RANGE = process.env.STUDENTS_RANGE || "student!A:Z";
    const rows = await readSheetObjects(RANGE);
    const students = rows
      .filter((r) => String(r.active ?? "TRUE").toUpperCase() !== "FALSE")
      .map((r) => ({
        id: String(r.id || ""),
        name: String(r.name || ""),
        school: String(r.school || ""),
        grade: Number(r.grade || 0),
        // [추가] 부분 설정을 위한 class_id도 포함
        class_id: String(r.class_id || ""),
      }));
    return res.status(200).json({ ok: true, students });
  } catch (e) {
    console.error("학생 목록 조회 실패:", e);
    return res.status(500).json({ ok: false, students: [], error: e.message });
  }
}
