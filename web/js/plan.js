// /web/js/plan.js
const $ = (q) => document.querySelector(q);
const api = (p, opt) => fetch(p, opt).then((r) => r.json());

async function loadBase() {
  // 반 목록
  const classes = await api("/api/class");
  if (!classes?.length) {
    $("#selClass").innerHTML = `<option value="">반 없음</option>`;
  } else {
    $("#selClass").innerHTML = classes
      .map(
        (c) => `<option value="${c.id}">${c.name} (${c.schedule_days})</option>`
      )
      .join("");
  }
  $("#selClass").onchange = onClassChange;
  await onClassChange();

  // 교재 마스터
  const mats = await api("/api/material");
  const mains = mats.filter(
    (m) => String(m.type || "").toUpperCase() === "MAIN"
  );
  const vocabs = mats.filter(
    (m) => String(m.type || "").toUpperCase() === "VOCAB"
  );

  $("#selMain").innerHTML =
    `<option value="">본교재 선택</option>` +
    mains
      .map((m) => `<option value="${m.material_id}">${m.title}</option>`)
      .join("");
  $("#selVocab").innerHTML =
    `<option value="">어휘교재 선택</option>` +
    vocabs
      .map((m) => `<option value="${m.material_id}">${m.title}</option>`)
      .join("");

  $("#selMain").onchange = renderMainUnits;
  $("#selVocab").onchange = renderVocabUnits;

  // 시작일 기본값 = 오늘
  const today = new Date();
  $("#startDate").value = today.toISOString().slice(0, 10);

  // 미리보기 버튼
  $("#btnPreview").onclick = previewPlan;
}

async function onClassChange() {
  const classId = $("#selClass").value;
  // 반 기본 요일 노출
  const classes = await api("/api/class");
  const cls = classes.find((c) => String(c.id) === String(classId));
  $("#classDays").textContent = cls ? `기본 요일: ${cls.schedule_days}` : "";

  // 해당 반의 학생
  const students = await api(
    `/api/student?classId=${encodeURIComponent(classId)}`
  );
  $("#selStudent").innerHTML = students?.length
    ? students
        .map(
          (s) =>
            `<option value="${s.id}">${s.name} (${s.school} ${s.grade})</option>`
        )
        .join("")
    : `<option value="">학생 없음</option>`;
}

async function renderMainUnits() {
  const matId = $("#selMain").value;
  if (!matId) {
    $("#mainUnits").innerHTML = "";
    return;
  }
  const rows = await api(
    `/api/mainBook?materialId=${encodeURIComponent(matId)}`
  );
  $("#mainUnits").innerHTML = rows
    .map(
      (u) => `
    <label>
      <input type="checkbox" value="${u.unit_code}">
      <b>${u.unit_code}</b> <span class="muted">${u.title || ""}</span>
      ${u.pages ? `<span class="pill">${u.pages}</span>` : ""}
      ${u.wb ? `<span class="pill">WB:${u.wb}</span>` : ""}
      ${u.dt_vocab ? `<span class="pill">단어:${u.dt_vocab}</span>` : ""}
      ${u.key_sents ? `<span class="pill">문장:${u.key_sents}</span>` : ""}
    </label>
  `
    )
    .join("");
}

async function renderVocabUnits() {
  const matId = $("#selVocab").value;
  if (!matId) {
    $("#vocabUnits").innerHTML = "";
    return;
  }
  const rows = await api(
    `/api/vocaBook?materialId=${encodeURIComponent(matId)}`
  );
  $("#vocabUnits").innerHTML = rows
    .map(
      (u) => `
    <label>
      <input type="checkbox" value="${u.unit_code}">
      <b>${u.unit_code}</b> <span class="pill">${u.vocab_range || ""}</span>
    </label>
  `
    )
    .join("");
}

function picked(containerSelector) {
  return [
    ...document.querySelectorAll(
      `${containerSelector} input[type=checkbox]:checked`
    ),
  ].map((i) => i.value);
}

async function previewPlan() {
  const classId = $("#selClass").value;
  const classes = await api("/api/class");
  const cls = classes.find((c) => String(c.id) === String(classId));
  const days = (
    $("#customDays").value ||
    cls?.schedule_days ||
    "MON,WED,FRI"
  ).toUpperCase();

  const startDate = $("#startDate").value;
  const mainId = $("#selMain").value;
  const mainCodes = picked("#mainUnits");
  const vocabId = $("#selVocab").value;
  const vocabCodes = picked("#vocabUnits");
  const vocabMode = $("#vocabMode").value;
  const maxMain = Number($("#maxMain").value || "1");

  if (!startDate) return alert("시작일을 선택하세요.");
  if (!mainId || mainCodes.length === 0)
    return alert("본교재와 차시를 선택하세요.");

  const body = {
    studentId: $("#selStudent").value,
    startDate,
    days,
    main: { materialId: mainId, unitCodes: mainCodes },
    vocabs:
      vocabId && vocabCodes.length
        ? [{ materialId: vocabId, unitCodes: vocabCodes }]
        : [],
    options: { maxMainPerDay: maxMain, vocabMode },
  };

  const res = await api("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    $("#result").textContent = res.error || "생성 실패";
    return;
  }

  const rows = res.items || [];
  if (!rows.length) {
    $("#result").textContent = "생성된 항목이 없습니다.";
    return;
  }

  const headers = [
    "date",
    "weekday",
    "material_id",
    "unit_code",
    "pages",
    "wb",
    "dt_vocab",
    "key_sents",
    "vocab_session",
    "vocab_range",
    "source",
  ];
  const thead = `<thead><tr>${headers
    .map((h) => `<th>${h}</th>`)
    .join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map(
      (r) => `<tr>${headers.map((h) => `<td>${r[h] || ""}</td>`).join("")}</tr>`
    )
    .join("")}</tbody>`;
  $(
    "#result"
  ).innerHTML = `<div class="muted mb">총 ${rows.length}행</div><table class="table">${thead}${tbody}</table>`;
}

document.addEventListener("DOMContentLoaded", loadBase);
