// /public/js/plan.js — 전체 교체 (최종본)

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
  selectedClassId: "",
  tests: [],
  testsMaster: [],
  selectedMonth: "",
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
  $("#selClassInfo").innerHTML = classOptions;

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
    console.error("시험 마스터 목록 로딩 실패", e);
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

  // 시험 UI 초기화
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

// -------- 월 선택 UI 관련 함수 --------
function renderMonthNavigator() {
  const [year, month] = state.selectedMonth.split("-");
  $("#testMonthDisplay").textContent = `${year}년 ${month}월`;
}

function updateMonth(change) {
  const d = new Date(state.selectedMonth + "-01");
  d.setMonth(d.getMonth() + change);
  state.selectedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}`;
  renderMonthNavigator();
  reloadTests();
}

// -------- 반 선택 시 처리 --------
async function onClassChange() {
  const classId = $("#selClass").value;
  state.selectedClassId = classId;
  $("#selClassInfo").value = classId;

  if (!classId) {
    $("#selStudent").innerHTML = "";
    $("#testList").innerHTML = "";
    return;
  }

  const res = await api(`/api/student?classId=${encodeURIComponent(classId)}`);
  const students = Array.isArray(res) ? res : res?.students || [];
  $("#selStudent").innerHTML =
    `<option value="">학생 선택</option>` +
    students
      .map(
        (s) =>
          `<option value="${s.id}">${s.name} (${s.school} ${s.grade})</option>`
      )
      .join("");
  await reloadTests();
}

// -------- 교재 Lane 관리 --------
async function addToLane(lane, materialId) {
  if (!materialId) return;

  const instanceId = `inst_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const title =
    (state.materials.find((m) => m.material_id === materialId) || {}).title ||
    materialId;
  const units =
    lane === "vocab"
      ? await api(`/api/vocaBook?materialId=${encodeURIComponent(materialId)}`)
      : await api(`/api/mainBook?materialId=${encodeURIComponent(materialId)}`);

  if (!Array.isArray(units) || !units.length)
    return alert("해당 교재의 차시가 없습니다.");

  state.lanes[lane].push({
    instanceId,
    materialId,
    title,
    units,
    startUnitCode: units[0].unit_code,
    endUnitCode: units[units.length - 1].unit_code,
  });
  renderLane(lane);
}

function removeFromLane(lane, instanceId) {
  state.lanes[lane] = state.lanes[lane].filter(
    (x) => x.instanceId !== instanceId
  );
  renderLane(lane);
}

function move(lane, instanceId, dir) {
  const arr = state.lanes[lane];
  const i = arr.findIndex((x) => x.instanceId === instanceId);
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
    .map((b) => {
      const startIndex = b.units.findIndex(
        (u) => u.unit_code === b.startUnitCode
      );

      const startOptions = b.units
        .map(
          (u) =>
            `<option value="${u.unit_code}" ${
              u.unit_code === b.startUnitCode ? "selected" : ""
            }>
          ${u.unit_code} — ${u.lecture_range || u.title || ""}
        </option>`
        )
        .join("");

      const endOptions = b.units
        .slice(startIndex)
        .map(
          (u) =>
            `<option value="${u.unit_code}" ${
              u.unit_code === b.endUnitCode ? "selected" : ""
            }>
          ${u.unit_code} — ${u.lecture_range || u.title || ""}
        </option>`
        )
        .join("");

      return `
      <div class="book-card">
        <div class="book-head">
          <div><b>${b.title}</b> <span class="small">(${b.materialId})</span></div>
          <div class="no-print">
            <button class="btn-xs" onclick="move('${lane}','${b.instanceId}',-1)">▲</button>
            <button class="btn-xs" onclick="move('${lane}','${b.instanceId}', 1)">▼</button>
            <button class="btn-xs" style="background:#ef4444" onclick="removeFromLane('${lane}','${b.instanceId}')">삭제</button>
          </div>
        </div>
        <div class="row mt">
          <div style="flex:1">
            <label class="small">시작 차시</label>
            <select data-type="start" data-lane="${lane}" data-id="${b.instanceId}">${startOptions}</select>
          </div>
          <div style="flex:1">
            <label class="small">종료 차시</label>
            <select data-type="end" data-lane="${lane}" data-id="${b.instanceId}">${endOptions}</select>
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  box.querySelectorAll("select[data-id]").forEach((s) => {
    s.onchange = (e) => {
      const { type, lane, id } = s.dataset;
      const book = state.lanes[lane].find((x) => x.instanceId === id);
      if (!book) return;

      if (type === "start") {
        book.startUnitCode = e.target.value;
        const startIndex = book.units.findIndex(
          (u) => u.unit_code === book.startUnitCode
        );
        const endIndex = book.units.findIndex(
          (u) => u.unit_code === book.endUnitCode
        );
        if (startIndex > endIndex) {
          book.endUnitCode = book.startUnitCode;
        }
        renderLane(lane);
      } else {
        book.endUnitCode = e.target.value;
      }
    };
  });
}

window.removeFromLane = removeFromLane;
window.move = move;

async function previewPlan() {
  const studentName =
    $("#selStudent option:checked")?.textContent?.split(" (")[0] || "";
  const startDate = $("#startDate").value;
  const endDate = $("#endDate").value;
  if (!startDate || !endDate) return alert("시작/끝 날짜를 선택하세요.");
  if (!studentName || studentName === "학생 선택")
    return alert("학생을 선택하세요.");

  const lanes = {};
  for (const ln of ["main1", "main2", "vocab"]) {
    lanes[ln] = state.lanes[ln].map((b) => ({
      materialId: b.materialId,
      startUnitCode: b.startUnitCode,
      endUnitCode: b.endUnitCode,
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
    days: (
      $("#customDays").value ||
      state.classes.find((c) => c.id === state.selectedClassId)
        ?.schedule_days ||
      "MON,WED,FRI"
    ).toUpperCase(),
    lanes,
    userSkips,
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
  const dates = [...new Set(items.map((i) => i.date))].sort();

  const usedMainMaterialIds = [
    ...new Set(
      items
        .filter((it) => it.source === "main" && it.material_id)
        .map((it) => it.material_id)
    ),
  ];

  const usedMaterials = usedMainMaterialIds
    .map((id) => state.materials.find((m) => m.material_id === id))
    .filter(Boolean);

  const materialsHeaderHtml = `
    <div class="materials-header">
      ${usedMaterials
        .map(
          (m) => `
        <div class="material-item">
          <div class="material-title">${m.title}</div>
          <div class="material-lecture">${m.lecture || "인강 정보 없음"}</div>
        </div>
      `
        )
        .join("")}
    </div>
  `;

  const studentHeader = `
    <div style="margin-bottom:12px;">
      <b>${ctx.studentName}</b> /
      ${ctx.startDate} ~ ${ctx.endDate}
    </div>`;

  const thead = `
    <thead style="font-size: 12px; text-align: center;">
      <tr>
        <th rowspan="3" style="width:100px; vertical-align: middle;">날짜</th>
        <th colspan="5" style="padding: 4px;">메인 1</th>
        <th colspan="5" style="padding: 4px;">메인 2</th>
        <th colspan="2" style="padding: 4px;">단어 DT</th>
      </tr>
      <tr>
        <th colspan="3" style="padding: 4px;">수업 진도</th>
        <th colspan="2" style="padding: 4px;">티칭 챌린지</th>
        <th colspan="3" style="padding: 4px;">수업 진도</th>
        <th colspan="2" style="padding: 4px;">티칭 챌린지</th>
        <th rowspan="2" style="vertical-align: middle; padding: 4px;">회차</th>
        <th rowspan="2" style="vertical-align: middle; padding: 4px;">DT</th>
      </tr>
      <tr>
        <th style="padding: 4px;">인강</th>
        <th style="padding: 4px;">교재 page</th>
        <th style="padding: 4px;">WB</th>
        <th style="padding: 4px;">개념+단어</th>
        <th style="padding: 4px;">문장학습</th>
        <th style="padding: 4px;">인강</th>
        <th style="padding: 4px;">교재 page</th>
        <th style="padding: 4px;">WB</th>
        <th style="padding: 4px;">개념+단어</th>
        <th style="padding: 4px;">문장학습</th>
      </tr>
    </thead>`;

  const rows = dates
    .map((d) => {
      const dayItems = items.filter((x) => x.date === d);
      const skip = dayItems.find((x) => x.source === "skip");
      const tests = dayItems.filter((x) => x.source === "test");

      const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"];
      const dateObj = new Date(d + "T00:00:00Z");
      const dayName = DOW_KR[dateObj.getUTCDay()];
      const dateString = `<b>${d.slice(2).replace(/-/g, ".")} (${dayName})</b>`;
      const tag = `data-date="${d}" class="js-date" style="cursor:pointer; text-decoration:underline;"`;

      if (skip) {
        return `<tr><td ${tag}>${dateString}</td><td colspan="12" style="color:#64748b;background:#f8fafc;">${skip.reason}</td></tr>`;
      }
      if (tests.length) {
        const testContent = tests.map((t) => t.title).join("<br>");
        return `<tr><td ${tag}>${dateString}</td><td colspan="12" style="background: #fffbe6;">${testContent}</td></tr>`;
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
      const v = dayItems.find((x) => x.source === "vocab");

      // [변경] OT 교재 처리 로직 (열 통합, 새 스타일)
      const renderMainLane = (mainItem) => {
        if (!mainItem) {
          return `<td></td><td></td><td></td><td></td><td></td>`;
        }
        if (mainItem.isOT) {
          const title =
            state.materials.find((m) => m.material_id === mainItem.material_id)
              ?.title || mainItem.material_id;
          return `<td colspan="5" style="background: #F9FF00; border: 1px solid red; font-weight: bold; text-align: center;">${title} OT</td>`;
        }
        return `<td>${mainItem.lecture_range || ""}</td>
                <td>${mainItem.pages ? `p.${mainItem.pages}` : ""}</td>
                <td>${mainItem.wb ? `p.${mainItem.wb}` : ""}</td>
                <td>${mainItem.dt_vocab || ""}</td>
                <td>${mainItem.key_sents || ""}</td>`;
      };

      const m1_html = renderMainLane(m1);
      const m2_html = renderMainLane(m2);

      return `<tr style="font-size: 14px;">
          <td ${tag}>${dateString}</td>
          ${m1_html}
          ${m2_html}
          <td>${v?.lecture_range || ""}</td>
          <td>${v?.vocab_range || ""}</td>
        </tr>`;
    })
    .join("");

  $("#result").innerHTML =
    studentHeader +
    materialsHeaderHtml +
    `<table class="table">${thead}<tbody>${rows}</tbody></table>`;

  document.querySelectorAll(".js-date").forEach((el) => {
    el.onclick = () => openSkipModal(el.getAttribute("data-date"));
  });
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
  const month = state.selectedMonth;
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
    el.innerHTML = `<div class="muted" style="padding:10px;">등록된 시험이 없습니다.</div>`;
    return;
  }
  el.innerHTML = state.tests
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(
      (t) => `
    <div class="test-item" data-id="${t.id}">
      <div class="test-info" style="flex-grow:1; display:flex; align-items:center; gap:8px;">
        <input type="date" value="${t.date}" disabled class="js-edit-date" style="border:none; background:transparent;"/>
        <b class="js-edit-title">${t.title}</b>
      </div>
      <div class="test-actions" style="display:flex; gap: 4px;">
        <button class="btn-xs" onclick="editTest('${t.id}')">수정</button>
        <button class="btn-xs" style="background:#ef4444" onclick="deleteTest('${t.id}')">삭제</button>
      </div>
    </div>`
    )
    .join("");
}

function editTest(id) {
  const item = $(`.test-item[data-id='${id}']`);
  if (!item) return;
  const dateInput = item.querySelector(".js-edit-date");
  const titleEl = item.querySelector(".js-edit-title");
  const originalTitle = titleEl.textContent;
  dateInput.disabled = false;
  dateInput.style.border = "1px solid #ccc";
  titleEl.innerHTML = `<input type="text" value="${originalTitle}" class="js-edit-title-input" />`;
  const actions = item.querySelector(".test-actions");
  actions.innerHTML = `
    <button class="btn-xs" onclick="updateTest('${id}')">저장</button>
    <button class="btn-xs" style="background:#94a3b8" onclick="reloadTests()">취소</button>`;
}

async function updateTest(id) {
  const item = $(`.test-item[data-id='${id}']`);
  if (!item) return;
  const patch = {
    date: item.querySelector(".js-edit-date").value,
    title: item.querySelector(".js-edit-title-input").value.trim(),
  };
  if (!patch.date || !patch.title) return alert("날짜와 시험명을 입력하세요.");
  const r = await api(`/api/test?id=${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    alert(r.error || "수정 실패");
    return;
  }
  await reloadTests();
}

async function addTest() {
  const classId = state.selectedClassId;
  if (!classId) return alert("반을 먼저 선택하세요.");
  const date = $("#newTestDate").value;
  const title = $("#newTestTitle").value.trim();
  if (!date || !title) return alert("날짜와 시험명을 선택하세요.");
  const r = await api(
    `/api/class-tests?classId=${encodeURIComponent(classId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, title }),
    }
  );
  if (!r.ok) {
    alert(r.error || "저장 실패");
    return;
  }
  $("#newTestDate").value = "";
  $("#newTestTitle").value = "";
  await reloadTests();
}

async function deleteTest(id) {
  if (!confirm("정말 삭제할까요?")) return;
  const r = await api(`/api/test?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!r.ok) {
    alert(r.error || "삭제 실패");
    return;
  }
  await reloadTests();
}

window.editTest = editTest;
window.updateTest = updateTest;
window.deleteTest = deleteTest;
