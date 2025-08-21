// /web/js/plan.js
const $ = (q) => document.querySelector(q);
const api = async (path, opt) => {
  const res = await fetch(path, opt);
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    // HTML/텍스트가 오면 에러로 던지되 앞부분만 출력
    throw new Error(
      `API ${path} -> ${res.status} ${res.statusText}\n${txt.slice(0, 160)}`
    );
  }
};
// 상태
const state = {
  classes: [],
  materials: [],
  lanes: { main1: [], main2: [], vocab: [] },
  exceptions: {},
  classTestName: "",
};
document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  // 반/학생
  state.classes = await api("/api/class");
  $("#selClass").innerHTML = state.classes
    .map(
      (c) => `<option value="${c.id}">${c.name} (${c.schedule_days})</option>`
    )
    .join("");
  $("#selClass").onchange = onClassChange;
  await onClassChange();

  // 교재
  const mats = await api("/api/materials");
  state.materials = mats;
  const mains = mats.filter((m) => String(m.type).toUpperCase() === "MAIN");
  const vocs = mats.filter((m) => String(m.type).toUpperCase() === "VOCAB");
  const opt = (arr) =>
    `<option value="">선택</option>` +
    arr
      .map((m) => `<option value="${m.material_id}">${m.title}</option>`)
      .join("");
  $("#selMain1").innerHTML = opt(mains);
  $("#selMain2").innerHTML = opt(mains);
  $("#selVocab").innerHTML = opt(vocs);

  $("#btnAddMain1").onclick = () => addToLane("main1", $("#selMain1").value);
  $("#btnAddMain2").onclick = () => addToLane("main2", $("#selMain2").value);
  $("#btnAddVocab").onclick = () => addToLane("vocab", $("#selVocab").value);

  $("#btnPreview").onclick = previewPlan;
  $("#btnPrint").onclick = () => window.print();

  // 날짜 기본값
  const today = new Date().toISOString().slice(0, 10);
  $("#startDate").value = today;
  $("#endDate").value = today;
}

async function onClassChange() {
  const classId = $("#selClass").value;
  const cls = state.classes.find((c) => c.id === classId);
  $("#classDays").textContent = cls ? `기본 요일: ${cls.schedule_days}` : "";
  state.classTestName = cls?.test || "";

  if (!classId || classId === "-1") {
    $("#selStudent").innerHTML = "";
    return;
  }
  const res = await api(`/api/student?classId=${encodeURIComponent(classId)}`);
  const students = Array.isArray(res) ? res : res?.students || [];
  $("#selStudent").innerHTML = students
    .map(
      (s) =>
        `<option value="${s.id}">${s.name} (${s.school} ${s.grade})</option>`
    )
    .join("");
}

async function addToLane(lane, materialId) {
  if (!materialId) return;
  const exists = state.lanes[lane].some((x) => x.materialId === materialId);
  if (exists) return alert("이미 추가된 교재입니다.");
  const title =
    (state.materials.find((m) => m.material_id === materialId) || {}).title ||
    materialId;
  const units =
    lane === "vocab"
      ? await api(`/api/vocaBook?materialId=${encodeURIComponent(materialId)}`)
      : await api(`/api/mainBook?materialId=${encodeURIComponent(materialId)}`);
  if (!units.length) return alert("해당 교재의 차시가 없습니다.");
  state.lanes[lane].push({
    materialId,
    title,
    units,
    startUnitCode: units[0].unit_code,
  });
  renderLane(lane);
}

function removeFromLane(lane, materialId) {
  state.lanes[lane] = state.lanes[lane].filter(
    (x) => x.materialId !== materialId
  );
  renderLane(lane);
}
function move(lane, materialId, dir) {
  const arr = state.lanes[lane];
  const i = arr.findIndex((x) => x.materialId === materialId);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  renderLane(lane);
}

function renderLane(lane) {
  const box =
    lane === "main1"
      ? $("#laneMain1")
      : lane === "main2"
      ? $("#laneMain2")
      : $("#laneVocab");
  const arr = state.lanes[lane];
  if (!arr.length) {
    box.innerHTML = `<div class="small muted">책을 추가하세요.</div>`;
    return;
  }
  box.innerHTML = arr
    .map(
      (b, i) => `
    <div class="book-card">
      <div class="book-head">
        <div><b>${b.title}</b> <span class="small">(${
        b.materialId
      })</span></div>
        <div class="no-print">
          <button onclick="move('${lane}','${b.materialId}',-1)">▲</button>
          <button onclick="move('${lane}','${b.materialId}', 1)">▼</button>
          <button onclick="removeFromLane('${lane}','${
        b.materialId
      }')">삭제</button>
        </div>
      </div>
      ${
        i === 0
          ? `
        <div class="row mt">
          <div style="flex:1">
            <label class="small">시작 차시</label>
            <select data-start="${lane}:${b.materialId}">
              ${b.units
                .map(
                  (u) =>
                    `<option value="${u.unit_code}" ${
                      u.unit_code === b.startUnitCode ? "selected" : ""
                    }>${u.unit_code} — ${
                      u.lecture_range || u.title || ""
                    }</option>`
                )
                .join("")}
            </select>
          </div>
        </div>`
          : `<div class="small muted mt">다음 책은 자동으로 첫 차시부터 시작</div>`
      }
    </div>
  `
    )
    .join("");

  box.querySelectorAll("select[data-start]").forEach((s) => {
    s.onchange = (e) => {
      const [ln, mid] = s.getAttribute("data-start").split(":");
      const it = state.lanes[ln].find((x) => x.materialId === mid);
      if (it) it.startUnitCode = e.target.value;
    };
  });
}
window.removeFromLane = removeFromLane;
window.move = move;

function getDaysCSV() {
  const classId = $("#selClass").value;
  const cls = state.classes.find((c) => c.id === classId);
  return (
    $("#customDays").value ||
    cls?.schedule_days ||
    "MON,WED,FRI"
  ).toUpperCase();
}

async function previewPlan() {
  const studentName =
    $("#selStudent option:checked")?.textContent?.split(" (")[0] || "";
  const startDate = $("#startDate").value;
  const endDate = $("#endDate").value;
  if (!startDate || !endDate) return alert("시작/끝 날짜를 선택하세요.");

  const lanes = {};
  for (const ln of ["main1", "main2", "vocab"]) {
    lanes[ln] = state.lanes[ln].map((b, idx) => ({
      materialId: b.materialId,
      ...(idx === 0 ? { startUnitCode: b.startUnitCode } : {}),
    }));
  }

  const userSkips = Object.entries(state.exceptions).map(([date, v]) => ({
    date,
    type: v.type,
    reason: v.reason || "",
  }));

  const body = {
    studentName,
    startDate,
    endDate,
    days: getDaysCSV(),
    lanes,
    userSkips,
    testName: state.classTestName, // ✅ 추가
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
  renderPrintable(res.items, { studentName, startDate, endDate, lanes });
}

function renderPrintable(items, ctx) {
  const titleOf = (id) =>
    (state.materials.find((m) => m.material_id === id) || {}).title || id;
  const dates = [...new Set(items.map((i) => i.date))].sort();

  const laneIds = {
    main1: [
      ...new Set(
        items.filter((i) => i.source === "main").map((i) => i.material_id)
      ),
    ], // 표시용
    main2: [],
    vocab: [],
  };
  // 테이블 컬럼 고정: 메인1, 메인2, 어휘
  const thead = `
    <thead><tr>
      <th style="width:110px">날짜</th>
      <th>메인1</th><th>메인2</th><th>어휘</th>
    </tr></thead>`;

  const rows = dates
    .map((d) => {
      const dayItems = items.filter((x) => x.date === d);
      const skip = dayItems.find((x) => x.source === "skip");
      const tag = `data-date="${d}" class="js-date" style="cursor:pointer; text-decoration:underline;"`;

      if (skip) {
        return `<tr>
        <td ${tag}><b>${d}</b></td>
        <td colspan="3" style="color:#64748b;background:#f8fafc;">${skip.reason}</td>
      </tr>`;
      }

      const m1 = dayItems.find(
        (x) =>
          x.source === "main" &&
          x.material_id &&
          ctx.lanes.main1.some((b) => b.materialId === x.material_id)
      );
      const m2 = dayItems.find(
        (x) =>
          x.source === "main" &&
          x.material_id &&
          ctx.lanes.main2.some((b) => b.materialId === x.material_id)
      );
      const vs = dayItems.filter((x) => x.source === "vocab");
      return `<tr>
      <td ${tag}><b>${d}</b></td>
      <td>${m1 ? formatMain(m1) : ""}</td>
      <td>${m2 ? formatMain(m2) : ""}</td>
      <td>${vs.map(formatVocab).join("<br>")}</td>
    </tr>`;
    })
    .join("");

  // ... 헤더 + 테이블 출력 ...
  const header = `
  <div style="margin-bottom:12px;">
    <b>${ctx.studentName || "학생"}</b> / 
    ${ctx.startDate} ~ ${ctx.endDate}
  </div>`;

  $("#result").innerHTML =
    header + `<table class="table">${thead}<tbody>${rows}</tbody></table>`;

  // ⬇️ 날짜 클릭 이벤트로 모달 열기
  document.querySelectorAll(".js-date").forEach((el) => {
    el.onclick = () => openSkipModal(el.getAttribute("data-date"));
  });
}

function formatMain(it) {
  const line1 = it.lecture_range || `${it.material_id} ${it.unit_code}`;
  const line2 = [
    it.pages && `p.${it.pages}`,
    it.wb && `WB ${it.wb}`,
    it.dt_vocab && `단어 ${it.dt_vocab}`,
    it.key_sents && `문장 ${it.key_sents}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return [line1, line2].filter(Boolean).join("<br>");
}
function formatVocab(it) {
  return [it.lecture_range, it.vocab_range].filter(Boolean).join(" · ");
}

function openSkipModal(date) {
  const modal = $("#skipModal");
  $("#skipDateLabel").textContent = date;
  $("#skipReason").value = state.exceptions[date]?.reason || "";
  modal.dataset.date = date;
  modal.style.display = "flex";
}
function closeSkipModal() {
  $("#skipModal").style.display = "none";
}

["vacation", "sick", "other"].forEach((t) => {
  document.querySelector(`#skipModal [data-sel='${t}']`).onclick = () => {
    const date = $("#skipModal").dataset.date;
    const reason = $("#skipReason").value.trim();
    state.exceptions[date] = { type: t, reason };
  };
});

$("#btnSkipSave").onclick = () => {
  closeSkipModal();
  previewPlan();
};
$("#btnSkipDelete").onclick = () => {
  const date = $("#skipModal").dataset.date;
  delete state.exceptions[date];
  closeSkipModal();
  previewPlan();
};
$("#btnSkipClose").onclick = closeSkipModal;

// ===== 반 관리 상태 =====
if (!window.state) window.state = {};
state.classes = state.classes || [];
state.selectedClassId = state.selectedClassId || "";
state.tests = state.tests || [];
state.testMonth = state.testMonth || "";

// 유틸
const $ = (q) => document.querySelector(q);
const api = async (p, opt) => {
  const r = await fetch(p, opt);
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    throw new Error(
      `API ${p} -> ${r.status} ${r.statusText}\n${t.slice(0, 160)}`
    );
  }
};
const yyyymm = (d) => String(d).slice(0, 7);

// 부트시 반/학생/교재 초기화
document.addEventListener("DOMContentLoaded", boot2);
async function boot2() {
  // 반 목록
  const classes = await api("/api/class");
  state.classes = classes;
  $("#selClass").innerHTML =
    `<option value="-1">반 선택</option>` +
    classes.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");

  // 이벤트 바인딩
  $("#selClass").addEventListener("change", onClassChange);
  $("#btnTestReload").addEventListener("click", reloadTests);
  $("#btnTestAdd").addEventListener("click", addTest);

  // 기본 월 = 오늘 기준
  const now = new Date();
  const mm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}`;
  $("#testMonth").value = mm;
}

// 반 선택 시 학생/시험 불러오기
async function onClassChange() {
  const classId = $("#selClass").value;
  state.selectedClassId = classId;
  // 학생
  if (classId && classId !== "-1") {
    const r = await api(`/api/student?classId=${encodeURIComponent(classId)}`);
    const students = Array.isArray(r) ? r : r.students || [];
    $("#selStudent").innerHTML = students
      .map(
        (s) =>
          `<option value="${s.id}">${s.name} (${s.school} ${s.grade})</option>`
      )
      .join("");
  } else {
    $("#selStudent").innerHTML = "";
  }
  // 시험
  await reloadTests();
}

async function reloadTests() {
  const classId = state.selectedClassId;
  if (!classId || classId === "-1") {
    $("#testList").innerHTML = "";
    return;
  }
  const month = $("#testMonth").value || "";
  const r = await api(
    `/api/class-tests?classId=${encodeURIComponent(
      classId
    )}&month=${encodeURIComponent(month)}`
  );
  state.tests = (r && r.items) || [];
  renderTests();
}

function renderTests() {
  const el = $("#testList");
  if (!state.tests.length) {
    el.innerHTML = `<div class="muted">등록된 시험이 없습니다.</div>`;
    return;
  }
  el.innerHTML = state.tests
    .map(
      (t) => `
    <div class="row" data-id="${t.id}" style="gap:8px">
      <input type="date" value="${t.date}">
      <input type="text" value="${t.title}">
      <input type="text" value="${
        t.materialId || ""
      }" placeholder="materialId(선택)">
      <button class="btn btn-xs" onclick="updateTest('${
        t.id
      }', this)">수정</button>
      <button class="btn btn-xs" style="background:#ef4444" onclick="deleteTest('${
        t.id
      }')">삭제</button>
    </div>`
    )
    .join("");
}

async function addTest() {
  const classId = state.selectedClassId;
  if (!classId || classId === "-1") return alert("반을 먼저 선택하세요.");
  const date = $("#newTestDate").value;
  const title = $("#newTestTitle").value.trim();
  const materialId = $("#newTestMaterial").value.trim();
  if (!date || !title) return alert("날짜와 시험명을 입력하세요.");

  const r = await api(
    `/api/class-tests?classId=${encodeURIComponent(classId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, title, materialId }),
    }
  );
  if (!r.ok) return alert(r.error || "저장 실패");
  $("#newTestDate").value = "";
  $("#newTestTitle").value = "";
  $("#newTestMaterial").value = "";
  await reloadTests();
}

async function updateTest(id, btn) {
  const row = btn.closest(".row");
  const [dateEl, titleEl, matEl] = row.querySelectorAll("input");
  const patch = {
    date: dateEl.value,
    title: titleEl.value.trim(),
    materialId: matEl.value.trim(),
  };
  const r = await api(`/api/test?id=${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return alert(r.error || "수정 실패");
  await reloadTests();
}

async function deleteTest(id) {
  if (!confirm("정말 삭제할까요?")) return;
  const r = await api(`/api/test?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!r.ok) return alert(r.error || "삭제 실패");
  await reloadTests();
}
