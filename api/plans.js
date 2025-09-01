// /api/plans.js — 최종 수정본

import { kv } from "@vercel/kv";
import { generatePlan } from "../lib/schedule.js";
// [추가] 새로운 이벤트 로직을 불러옵니다.
import { getEvents } from "../lib/kv.js";

// KV 데이터베이스가 준비되었는지 확인하는 함수
function isKvReady() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

// 학생의 모든 플랜을 가져오는 함수
async function getPlansByStudent(studentId) {
  if (!studentId || !isKvReady()) {
    return [];
  }
  try {
    return (await kv.get(`plans:${studentId}`)) || [];
  } catch (e) {
    console.error("KV read error:", e);
    return [];
  }
}

// 학생의 모든 플랜을 저장하는 함수
async function savePlansForStudent(studentId, plans) {
  if (!isKvReady()) {
    throw new Error("저장 기능(KV 데이터베이스)이 설정되지 않았습니다.");
  }
  if (!studentId) {
    throw new Error("플랜을 저장하려면 학생 ID가 필요합니다.");
  }
  await kv.set(`plans:${studentId}`, plans);
}

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

  // --- POST: 새 플랜 생성 ---
  if (req.method === "POST") {
    try {
      if (!isKvReady()) {
        throw new Error("저장 기능이 설정되지 않아 플랜을 생성할 수 없습니다.");
      }
      const body = req.body;
      const { students, ...planConfig } = body;
      if (!Array.isArray(students) || students.length === 0) {
        return res
          .status(400)
          .json({ ok: false, error: "Students array is required." });
      }

      // [수정] getAllTests() 대신 새로운 getEvents() 사용
      const allEvents = await getEvents();

      // 학생별로 플랜을 생성하고 저장합니다.
      for (const student of students) {
        const studentPlans = await getPlansByStudent(student.id);
        const generatedItems = await generatePlan({
          ...planConfig,
          events: allEvents, // 생성 로직에 events 전달
          studentInfo: student, // 학생 정보 전달
        });

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
        throw new Error("저장 기능이 설정되지 않아 플랜을 수정할 수 없습니다.");
      }
      const body = req.body;
      const { studentId, studentInfo, ...planConfig } = body;
      const studentPlans = await getPlansByStudent(studentId);
      const planIndex = studentPlans.findIndex((p) => p.planId === planId);

      if (planIndex === -1) {
        return res.status(404).json({ ok: false, error: "Plan not found." });
      }

      // [수정] getAllTests() 대신 새로운 getEvents() 사용
      const allEvents = await getEvents();

      const updatedItems = await generatePlan({
        ...planConfig,
        events: allEvents, // 생성 로직에 events 전달
        studentInfo: studentInfo, // 학생 정보 전달
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
        throw new Error("저장 기능이 설정되지 않아 플랜을 삭제할 수 없습니다.");
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
