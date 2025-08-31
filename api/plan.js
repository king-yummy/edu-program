// /api/plans.js — 수정본

import { kv } from "@vercel/kv";
import { generatePlan } from "../lib/schedule.js";
import { getAllTests } from "../lib/kv.js";

// [추가] KV 데이터베이스가 준비되었는지 확인하는 함수
function isKvReady() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// [수정] 학생의 모든 플랜을 가져오는 함수 (안정성 강화)
async function getPlansByStudent(studentId) {
  // KV가 준비되지 않았거나 studentId가 없으면 그냥 빈 배열을 반환
  if (!studentId || !isKvReady()) {
    return [];
  }
  try {
    return (await kv.get(`plans:${studentId}`)) || [];
  } catch (e) {
    console.error("KV read error:", e);
    // KV에서 읽는 중 에러가 발생해도 앱이 멈추지 않도록 빈 배열 반환
    return [];
  }
}

// [수정] 학생의 모든 플랜을 저장하는 함수 (안정성 강화)
async function savePlansForStudent(studentId, plans) {
  if (!isKvReady()) {
    throw new Error("저장 기능(KV 데이터베이스)이 설정되지 않았습니다.");
  }
  if (!studentId) {
    throw new Error("플랜을 저장하려면 학생 ID가 필요합니다.");
  }
  await kv.set(`plans:${studentId}`, plans);
}

// --- 핸들러 함수 (이하는 기존과 거의 동일, 에러 핸들링만 강화) ---
export default async function handler(req, res) {
  const { studentId, planId } = req.query;

  // --- GET: 특정 학생의 모든 플랜 조회 ---
  if (req.method === "GET" && studentId) {
    try {
      const plans = await getPlansByStudent(studentId);
      return res.status(200).json({ ok: true, plans });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- POST: 새 플랜 생성 (단일/다수 학생) ---
  if (req.method === "POST") {
    try {
      // KV가 준비되지 않았으면 저장 시도 전에 에러 발생
      if (!isKvReady()) {
        throw new Error(
          "저장 기능(KV 데이터베이스)이 설정되지 않아 플랜을 생성할 수 없습니다."
        );
      }
      const body = req.body;
      const { students, ...planConfig } = body;
      if (!Array.isArray(students) || students.length === 0) {
        return res
          .status(400)
          .json({ ok: false, error: "Students array is required." });
      }

      const allTests = await getAllTests();
      const testsInRange = allTests.filter((t) => {
        const testDate = new Date(t.date).toISOString().slice(0, 10);
        return (
          testDate >= planConfig.startDate && testDate <= planConfig.endDate
        );
      });

      const generatedItems = await generatePlan({
        ...planConfig,
        tests: testsInRange,
      });

      for (const student of students) {
        const studentPlans = await getPlansByStudent(student.id);
        const newPlan = {
          planId: `pln_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          studentId: student.id,
          createdAt: new Date().toISOString(),
          context: planConfig,
          items: generatedItems,
        };
        studentPlans.push(newPlan);
        await savePlansForStudent(student.id, studentPlans);
      }
      return res.status(201).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- PUT: 기존 플랜 수정 ---
  if (req.method === "PUT" && planId) {
    try {
      if (!isKvReady()) {
        throw new Error(
          "저장 기능(KV 데이터베이스)이 설정되지 않아 플랜을 수정할 수 없습니다."
        );
      }
      const body = req.body;
      const { studentId, ...planConfig } = body;
      const studentPlans = await getPlansByStudent(studentId);
      const planIndex = studentPlans.findIndex((p) => p.planId === planId);

      if (planIndex === -1) {
        return res.status(404).json({ ok: false, error: "Plan not found." });
      }

      const allTests = await getAllTests();
      const testsInRange = allTests.filter((t) => {
        const testDate = new Date(t.date).toISOString().slice(0, 10);
        return (
          testDate >= planConfig.startDate && testDate <= planConfig.endDate
        );
      });

      const updatedItems = await generatePlan({
        ...planConfig,
        tests: testsInRange,
      });

      studentPlans[planIndex].context = planConfig;
      studentPlans[planIndex].items = updatedItems;
      studentPlans[planIndex].updatedAt = new Date().toISOString();

      await savePlansForStudent(studentId, studentPlans);
      return res.status(200).json({ ok: true, plan: studentPlans[planIndex] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- DELETE: 기존 플랜 삭제 ---
  if (req.method === "DELETE" && planId) {
    try {
      if (!isKvReady()) {
        throw new Error(
          "저장 기능(KV 데이터베이스)이 설정되지 않아 플랜을 삭제할 수 없습니다."
        );
      }
      const { studentId } = req.query;
      let studentPlans = await getPlansByStudent(studentId);
      const initialLength = studentPlans.length;
      studentPlans = studentPlans.filter((p) => p.planId !== planId);

      if (studentPlans.length === initialLength) {
        return res.status(404).json({ ok: false, error: "Plan not found." });
      }

      await savePlansForStudent(studentId, studentPlans);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
  return res
    .status(405)
    .json({ ok: false, error: `Method ${req.method} Not Allowed` });
}
