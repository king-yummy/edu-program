// api/student.js
import { readSheetObjects } from "../lib/sheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const { classId } = req.query || {};

  // 선택 안 했거나 placeholder(-1)면 그냥 빈 리스트로 200
  if (!classId || String(classId) === "-1") {
    return res
      .status(200)
      .json({ ok: true, classId: String(classId || ""), students: [] });
  }

  try {
    const RANGE = process.env.STUDENTS_RANGE || "student!A:Z";
    const rows = await readSheetObjects(RANGE);

    // 시트 컬럼: id | class_id | name | school | grade | active
    const students = rows
      .filter((r) => String(r.class_id).trim() === String(classId).trim())
      .filter((r) => String(r.active ?? "TRUE").toUpperCase() !== "FALSE")
      .map((r) => ({
        id: String(r.id || ""),
        name: String(r.name || ""),
        school: String(r.school || ""),
        grade: Number(r.grade || 0),
      }));

    return res
      .status(200)
      .json({ ok: true, classId: String(classId), students });
  } catch (e) {
    // 에러여도 200 + 빈 배열(프런트가 404 HTML을 JSON으로 파싱하려다 터지는 걸 방지)
    return res
      .status(200)
      .json({ ok: true, classId: String(classId), students: [] });
  }
}
