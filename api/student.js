// api/student.js  (ESM)
import { readSheetObjects } from "../lib/sheets.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const { classId } = req.query || {};
  if (!classId)
    return res.status(400).json({ ok: false, error: "classId required" });

  const range = process.env.CLASSES_RANGE || "Classes!A:Z";
  try {
    const rows = await readSheetObjects(range);

    // 시트 컬럼 유연 매핑: id/name/students
    const norm = rows.map((r, i) => ({
      id: String(r.id ?? r.ID ?? r.classId ?? r.ClassId ?? `C${i + 1}`),
      name: String(r.name ?? r.class ?? r.Class ?? `Class ${i + 1}`),
      studentsStr: String(r.students ?? r.Students ?? ""),
      raw: r,
    }));

    // id 또는 name으로 매칭
    const target =
      norm.find((x) => x.id === String(classId)) ||
      norm.find((x) => x.name === String(classId));

    if (!target) {
      // 못 찾으면 비어있는 리스트로 200 반환(프런트 에러 방지)
      return res
        .status(200)
        .json({
          ok: true,
          classId: String(classId),
          className: "",
          students: [],
        });
    }

    // 학생 리스트 파싱: "a,b,c" 또는 줄바꿈 등
    let students = [];
    if (target.studentsStr) {
      students = target.studentsStr
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      // student1, student2 ... 같은 열이 있는 경우도 지원
      students = Object.entries(target.raw)
        .filter(([k, v]) => /^student/i.test(k) && String(v).trim())
        .map(([, v]) => String(v).trim());
    }

    return res.status(200).json({
      ok: true,
      classId: target.id,
      className: target.name,
      students,
    });
  } catch (e) {
    // 초기 세팅 단계에선 에러 대신 빈 결과(404 JSON 파싱 에러 방지)
    return res
      .status(200)
      .json({
        ok: true,
        classId: String(classId),
        className: "",
        students: [],
      });
  }
}
