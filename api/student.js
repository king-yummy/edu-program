import { readSheetObjects } from "../lib/sheets.js";
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }
  const { classId } = req.query || {};
  if (!classId || String(classId) === "-1") {
    return res
      .status(200)
      .json({ ok: true, classId: String(classId || ""), students: [] });
  }
  try {
    const RANGE = process.env.STUDENTS_RANGE || "student!A:Z";
    const rows = await readSheetObjects(RANGE);
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
  } catch {
    return res
      .status(200)
      .json({ ok: true, classId: String(classId), students: [] });
  }
}
