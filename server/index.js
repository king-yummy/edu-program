// server/index.js
const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
dotenv.config();

const { readSheetObjects } = require("./sheets");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

// ✅ 정적 파일 경로 추가 (web 폴더 기준)
const publicDir = path.resolve(process.cwd(), "web");
app.use(express.static(publicDir));

// ✅ 루트("/")로 접속하면 plan.html 보여주기
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "plan.html"));
});

// 헬스체크
app.get("/api/health", (req, res) => res.json({ ok: true }));

// 1) 반 목록
app.get("/api/class", async (req, res) => {
  try {
    const rows = await readSheetObjects("class");
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "class 시트 읽기 실패" });
  }
});

// 2) 학생 목록 (classId로 필터 가능)
app.get("/api/student", async (req, res) => {
  try {
    const rows = await readSheetObjects("student");
    const { classId } = req.query;
    const filtered = classId
      ? rows.filter((r) => r.class_id === classId)
      : rows;
    res.json(filtered);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "student 시트 읽기 실패" });
  }
});

// 3) 교재 마스터 (type 필터: MAIN | VOCAB)
app.get("/api/material", async (req, res) => {
  try {
    const rows = await readSheetObjects("material");
    const { type } = req.query;
    const filtered = type
      ? rows.filter(
          (r) => String(r.type).toUpperCase() === String(type).toUpperCase()
        )
      : rows;
    res.json(filtered);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "material 시트 읽기 실패" });
  }
});

// 4) 본교재 커리큘럼(mainBook) — material_id로 필터
app.get("/api/mainBook", async (req, res) => {
  try {
    const rows = await readSheetObjects("mainBook");
    const { materialId } = req.query;
    const sorted = rows.sort(
      (a, b) => Number(a.order || 0) - Number(b.order || 0)
    );
    const filtered = materialId
      ? sorted.filter((r) => r.material_id === materialId)
      : sorted;
    res.json(filtered);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "mainBook 시트 읽기 실패" });
  }
});

// 5) 어휘교재 커리큘럼(vocaBook) — material_id로 필터
app.get("/api/vocaBook", async (req, res) => {
  try {
    const rows = await readSheetObjects("vocaBook");
    const { materialId } = req.query;
    const sorted = rows.sort(
      (a, b) => Number(a.order || 0) - Number(b.order || 0)
    );
    const filtered = materialId
      ? sorted.filter((r) => r.material_id === materialId)
      : sorted;
    res.json(filtered);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "vocaBook 시트 읽기 실패" });
  }
});

// 레슨플랜 미리보기 생성
const { generatePlan } = require("./schedule");
app.post("/api/plan", async (req, res) => {
  try {
    const items = await generatePlan(req.body || {});
    // v2에서 PlanItems 시트에 append 예정
    res.json({ ok: true, planId: `PLN-${Date.now()}`, items });
  } catch (e) {
    console.error(e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
