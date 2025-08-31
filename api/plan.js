// /api/plans.js — 신규 파일

import { kv } from "@vercel/kv";
import { generatePlan } from "../lib/schedule.js";
import { getAllTests } from "../lib/kv.js";

// 학생의 모든 플랜을 가져오는 함수
async function getPlansByStudent(studentId) {
  if (!studentId) return [];
  return (await kv.get(`plans:${studentId}`)) || [];
}

// 학생의 모든 플랜을 저장하는 함수
async function savePlansForStudent(studentId, plans) {
  if (!studentId) throw new Error("Student ID is required to save plans.");
  await kv.set(`plans:${studentId}`, plans);
}

const toYMD = (d) => d.toISOString().slice(0, 10);

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
