// /api/plans.js — 최종 완성본

import { kv } from "@vercel/kv";
import { generatePlan } from "../lib/schedule.js";
import { getEvents } from "../lib/kv.js";

function isKvReady() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function getPlansByStudent(studentId) {
  if (!studentId || !isKvReady()) return [];
  try {
    return (await kv.get(`plans:${studentId}`)) || [];
  } catch (e) {
    console.error("KV read error:", e);
    return [];
  }
}

async function savePlansForStudent(studentId, plans) {
  if (!isKvReady())
    throw new Error("저장 기능(KV 데이터베이스)이 설정되지 않았습니다.");
  if (!studentId) throw new Error("플랜을 저장하려면 학생 ID가 필요합니다.");
  await kv.set(`plans:${studentId}`, plans);
}

export default async function handler(req, res) {
  const { studentId, planId } = req.query;

  if (req.method === "GET" && studentId) {
    try {
      const plans = await getPlansByStudent(studentId);
      return res.status(200).json({ ok: true, plans });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (req.method === "POST") {
    try {
      if (!isKvReady())
        throw new Error("저장 기능이 설정되지 않아 플랜을 생성할 수 없습니다.");
      const body = req.body;
      const { students, ...planData } = body;
      if (!Array.isArray(students) || students.length === 0) {
        return res
          .status(400)
          .json({ ok: false, error: "Students array is required." });
      }

      for (const student of students) {
        const studentPlans = await getPlansByStudent(student.id);
        const newPlan = {
          planId: planData.planId || `pln_${Date.now()}`,
          studentId: student.id,
          createdAt: new Date().toISOString(),
          planSegments: planData.planSegments,
          userSkips: planData.userSkips,
        };
        studentPlans.push(newPlan);
        await savePlansForStudent(student.id, studentPlans);
      }
      return res.status(201).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (req.method === "PUT" && planId) {
    try {
      if (!isKvReady())
        throw new Error("저장 기능이 설정되지 않아 플랜을 수정할 수 없습니다.");
      const body = req.body;
      const { studentId, ...planData } = body;
      const studentPlans = await getPlansByStudent(studentId);
      const planIndex = studentPlans.findIndex((p) => p.planId === planId);
      if (planIndex === -1) {
        return res.status(404).json({ ok: false, error: "Plan not found." });
      }

      studentPlans[planIndex] = {
        ...studentPlans[planIndex],
        ...planData,
        updatedAt: new Date().toISOString(),
      };

      await savePlansForStudent(studentId, studentPlans);
      return res.status(200).json({ ok: true, plan: studentPlans[planIndex] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (req.method === "DELETE" && planId) {
    try {
      if (!isKvReady())
        throw new Error("저장 기능이 설정되지 않아 플랜을 삭제할 수 없습니다.");
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
