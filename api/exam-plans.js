// /api/exam-plans.js — 신규 파일

import { kv } from "@vercel/kv";
import { readSheetObjects } from "../lib/sheets.js";

// --- Helper Functions ---

function isKvReady() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// 학교와 학년 기준으로 내신 플랜 Key 생성
function getExamPlanKey(school, grade) {
  return `exam-plans:${encodeURIComponent(school)}:${grade}`;
}

// 학생별 개인 플랜 Key 생성
function getStudentPlanKey(studentId) {
  return `plans:${studentId}`;
}

// --- Main Handler ---

export default async function handler(req, res) {
  if (!isKvReady()) {
    return res
      .status(501)
      .json({ ok: false, error: "KV 데이터베이스가 설정되지 않았습니다." });
  }

  // --- GET: 특정 학교/학년의 내신 플랜 목록 조회 ---
  if (req.method === "GET") {
    const { school, grade } = req.query;
    if (!school || !grade) {
      return res
        .status(400)
        .json({ ok: false, error: "school and grade가 필요합니다." });
    }
    try {
      const key = getExamPlanKey(school, grade);
      const examPlans = (await kv.get(key)) || [];
      return res.status(200).json({ ok: true, examPlans });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- POST: 새 내신 플랜 생성 및 학생 플랜에 적용 ---
  if (req.method === "POST") {
    try {
      const { school, grade, planData } = req.body;
      if (!school || !grade || !planData) {
        return res
          .status(400)
          .json({ ok: false, error: "school, grade, planData가 필요합니다." });
      }

      // 1. 대상 학생 목록 조회
      const allStudents = await readSheetObjects(
        process.env.STUDENTS_RANGE || "student!A:Z"
      );
      const targetStudents = allStudents.filter(
        (s) => s.school === school && String(s.grade) === String(grade)
      );

      if (targetStudents.length === 0) {
        return res
          .status(404)
          .json({ ok: false, error: "해당하는 학생을 찾을 수 없습니다." });
      }

      // 2. 새 내신 플랜 객체 생성
      const newExamPlan = {
        ...planData,
        id: `exam_${Date.now()}`,
        createdAt: new Date().toISOString(),
      };

      // 3. 학생별로 기존 플랜에 내신 플랜 삽입/수정
      for (const student of targetStudents) {
        const studentPlanKey = getStudentPlanKey(student.id);
        let studentPlans = (await kv.get(studentPlanKey)) || [];

        // 여기에 내신 기간을 기존 플랜에 삽입하고 뒤로 미루는 복잡한 로직이 들어가야 합니다.
        // 지금은 단순화를 위해, 기존 플랜을 모두 덮어쓰는 대신
        // "기존 플랜이 있으면 맨 뒤에 추가, 없으면 새로 생성"하는 방식으로 구현합니다.
        // (추후 이 부분을 정교하게 다듬어야 합니다)

        const examSegment = {
          id: `seg_${newExamPlan.id}`,
          startDate: newExamPlan.startDate,
          endDate: newExamPlan.endDate,
          days: newExamPlan.days,
          lanes: newExamPlan.lanes,
        };

        // 간단한 구현: 일단은 그냥 새 플랜으로 추가합니다.
        const studentPersonalPlan = {
          planId: `pln_exam_${student.id}_${newExamPlan.id}`,
          studentId: student.id,
          createdAt: new Date().toISOString(),
          planSegments: [examSegment],
          userSkips: {}, // 내신 기간에는 개인 스킵 초기화
        };

        // 해당 학생의 기존 플랜 중 내신 기간과 겹치는 플랜이 있는지 확인하고 처리하는 로직 필요
        // 지금은 단순하게 추가합니다.
        studentPlans.push(studentPersonalPlan);

        await kv.set(studentPlanKey, studentPlans);
      }

      // 4. 학교/학년별 내신 플랜 목록에 새 플랜 추가 및 저장
      const examPlanKey = getExamPlanKey(school, grade);
      const examPlans = (await kv.get(examPlanKey)) || [];
      examPlans.push(newExamPlan);
      await kv.set(examPlanKey, examPlans);

      return res.status(201).json({ ok: true, newExamPlan });
    } catch (e) {
      console.error("내신 플랜 생성 실패:", e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- DELETE: 내신 플랜 삭제 ---
  if (req.method === "DELETE") {
    try {
      const { school, grade, examPlanId } = req.query;
      if (!school || !grade || !examPlanId) {
        return res
          .status(400)
          .json({
            ok: false,
            error: "school, grade, examPlanId가 필요합니다.",
          });
      }

      const examPlanKey = getExamPlanKey(school, grade);
      let examPlans = (await kv.get(examPlanKey)) || [];

      const initialLength = examPlans.length;
      examPlans = examPlans.filter((p) => p.id !== examPlanId);

      if (examPlans.length === initialLength) {
        return res
          .status(404)
          .json({ ok: false, error: "삭제할 내신 플랜을 찾지 못했습니다." });
      }

      await kv.set(examPlanKey, examPlans);

      // (심화) 여기서 해당 내신 플랜을 받았던 모든 학생들의 개인 플랜에 찾아가서
      // 해당 내신 기간을 삭제하고 뒤에 밀렸던 플랜을 다시 앞으로 당겨오는 로직이 필요합니다.
      // 지금은 관리 목록에서만 삭제합니다.

      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res
    .status(405)
    .json({ ok: false, error: `Method ${req.method} Not Allowed` });
}
