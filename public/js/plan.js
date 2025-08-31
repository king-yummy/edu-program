// /public/js/plan.js — 전체 교체
// -------- 공통 유틸 --------
const $ = (q) => document.querySelector(q);
const api = async (path, opt) => {
  const res = await fetch(path, opt);
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(
      `API ${path} -> ${res.status} ${res.statusText}\n${txt.slice(0, 160)}`
    );
  }
};

// -------- 전역 상태 --------
const state = {
  classes: [],
  materials: [],
  lanes: { main1: [], main2: [], vocab: [] },
  exceptions: {},
  classTestName: "",
  selectedClassId: "",
  tests: [],
  testsMaster: [], // [추가] 시험 마스터 목록 저장
};

// -------- 부트스트랩 --------
document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  // 반 목록
  state.classes = await api("/api/class");
  const classOptions = state.classes
    .map(
      (c) => `<option value="${c.id}">${c.name} (${c.schedule_days})</option>`
    )
    .join("");
  $("#selClass").innerHTML = classOptions;
  $("#selClassInfo").innerHTML = classOptions; // 기본 정보 섹션의 반 목록도 채우기
  $("#selClass").onchange = onClassChange;
  $("#selClassInfo").onchange = (e) => {
    $("#selClass").value = e.target.value;
    onClassChange();
  };

  // 교재 목록
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

  // 시험 마스터 목록 로드
  try {
    state.testsMaster = await api("/api/tests-master");
    if (Array.isArray(state.testsMaster)) {
      $("#newTestTitle").innerHTML =
        `<option value="">시험 선택</option>` +
        state.testsMaster
          .map((t) => `<option value="${t.name}">${t.name}</option>`)
          .join("");
    }
  } catch (e) {
    console.error("시험 목록을 불러오는데 실패했습니다.", e);
  }

  // 버튼
  $("#btnAddMain1").onclick = () => addToLane("main1", $("#selMain1").value);
  $("#btnAddMain2").onclick = () => addToLane("main2", $("#selMain2").value);
  $("#btnAddVocab").onclick = () => addToLane("vocab", $("#selVocab").value);
  $("#btnPreview").onclick = previewPlan;
  $("#btnPrint").onclick = () => window.print();

  // 날짜 기본값
  const today = new Date().toISOString().slice(0, 10);
  $("#startDate").value = today;
  $("#endDate").value = today;

  // [수정 완료된 최종 버전] 시험 UI 초기화
  const now = new Date();
  state.selectedMonth = `${now.getFullYear()}-${String(
    now.getMonth() + 1
  ).padStart(2, "0")}`;
  renderMonthNavigator();
  $("#btnPrevMonth").onclick = () => updateMonth(-1);
  $("#btnNextMonth").onclick = () => updateMonth(1);
  $("#btnTestAdd")?.addEventListener("click", addTest);

  // 첫 반 선택 강제 실행
  await onClassChange();
}

// -------- 반 선택 시 처리(학생+시험) --------
async function onClassChange() {
  const classId = $("#selClass").value;
  state.selectedClassId = classId;

  const cls = state.classes.find((c) => c.id === classId);
  $("#classDays").textContent = cls ? `기본 요일: ${cls.schedule_days}` : "";
  state.classTestName = cls?.test || "";

  if (!classId) {
    $("#selStudent").innerHTML = "";
    $("#testList").innerHTML = "";
    return;
  }

  // 학생 로드
  const res = await api(`/api/student?classId=${encodeURIComponent(classId)}`);
  const students = Array.isArray(res) ? res : res?.students || [];
  $("#selStudent").innerHTML = students
    .map(
      (s) =>
        `<option value="${s.id}">${s.name} (${s.school} ${s.grade})</option>`
    )
    .join("");

  // 시험 로드
  await reloadTests();
}

// -------- 교재 Lane 관리 --------
async function addToLane(lane, materialId) {
  if (!materialId) return;
  const exists = state.lanes[lane].some((x) => x.materialId === materialId);
  if (exists) return alert("이미 추가된 교재입니다.");

  const title =
    (state.materials.find((m) => m.material_id === materialId) || {}).title ||
    materialId;

  // 각 교재의 유닛(차시) 불러오기 — 서버에 /api/mainBook, /api/vocaBook 라우트가 있어야 함
  const units =
    lane === "vocab"
      ? await api(`/api/vocaBook?materialId=${encodeURIComponent(materialId)}`)
      : await api(`/api/mainBook?materialId=${encodeURIComponent(materialId)}`);

  if (!Array.isArray(units) || !units.length)
    return alert("해당 교재의 차시가 없습니다.");

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
                    }>
                  ${u.unit_code} — ${u.lecture_range || u.title || ""}
                </option>`
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

// 전역에서 버튼이 접근할 수 있게 노출
window.removeFromLane = removeFromLane;
window.move = move;

// -------- 플랜 생성 --------
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
    classId: state.selectedClassId,
    studentName,
    startDate,
    endDate,
    days: getDaysCSV(),
    lanes,
    userSkips,
    testName: state.classTestName,
    tests: state.tests, // [수정] 미리보기 생성 시 저장된 시험 정보 함께 전송
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

  const thead = `
    <thead><tr>
      <th style="width:110px">날짜</th>
      <th>메인1</th><th>메인2</th><th>어휘</th>
    </tr></thead>`;

  const rows = dates
    .map((d) => {
      const dayItems = items.filter((x) => x.date === d);
      const skip = dayItems.find((x) => x.source === "skip");
      const tests = dayItems.filter((x) => x.source === "test"); // [수정] 하루에 여러 시험이 있을 수 있음
      const tag = `data-date="${d}" class="js-date" style="cursor:pointer; text-decoration:underline;"`;

      if (skip) {
        return `<tr>
        <td ${tag}><b>${d}</b></td>
        <td colspan="3" style="color:#64748b;background:#f8fafc;">${skip.reason}</td>
      </tr>`;
      }

      if (tests.length > 0) {
        // [수정] 시험 렌더링 방식 변경
        const testContent = tests.map((t) => `${t.title}`).join("<br>");
        return `<tr>
        <td ${tag}><b>${d}</b></td>
        <td colspan="3" style="background: #fffbe6;">${testContent}</td>
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

  const header = `
    <div style="margin-bottom:12px;">
      <b>${ctx.studentName || "학생"}</b> /
      ${ctx.startDate} ~ ${ctx.endDate}
    </div>`;

  $("#result").innerHTML =
    header + `<table class="table">${thead}<tbody>${rows}</tbody></table>`;

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

// -------- 스킵(예외) 모달 --------
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
  const btn = document.querySelector(`#skipModal [data-sel='${t}']`);
  if (btn)
    btn.onclick = () => {
      const date = $("#skipModal").dataset.date;
      const reason = $("#skipReason").value.trim();
      state.exceptions[date] = { type: t, reason };
    };
});
$("#btnSkipSave")?.addEventListener("click", () => {
  closeSkipModal();
  previewPlan();
});
$("#btnSkipDelete")?.addEventListener("click", () => {
  const date = $("#skipModal").dataset.date;
  delete state.exceptions[date];
  closeSkipModal();
  previewPlan();
});
$("#btnSkipClose")?.addEventListener("click", closeSkipModal);

// -------- 시험 CRUD --------
async function reloadTests() {
  const classId = state.selectedClassId;
  const el = $("#testList");
  if (!classId) {
    if (el) el.innerHTML = "";
    return;
  }
  const month = $("#testMonth")?.value || "";
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
  if (!el) return;
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
    </div>
  `
    )
    .join("");
}

async function addTest() {
  const classId = state.selectedClassId;
  if (!classId) return alert("반을 먼저 선택하세요.");
  const date = $("#newTestDate").value;
  const title = $("#newTestTitle").value.trim();
  const materialId = $("#newTestMaterial").value.trim();
  if (!date || !title) return alert("날짜와 시험명을 선택하세요.");

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

// updateTest와 deleteTest를 전역 스코프에 노출시켜 HTML에서 직접 호출할 수 있도록 합니다.
window.updateTest = updateTest;
window.deleteTest = deleteTest;
