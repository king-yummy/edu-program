// /public/js/plan.js — 수정본 (tests 관련 기능 제거)

const $ = (q) => document.querySelector(q);
const api = async (path, opt) => {
  const res = await fetch(path, opt);
  if (!res.ok) {
    const errorBody = await res
      .json()
      .catch(() => ({ error: "API 요청 실패" }));
    throw new Error(errorBody.error || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return { ok: true };
  return res.json();
};

const state = {
  classes: [],
  materials: [],
  lanes: { main1: [], main2: [], vocab: [] },
  exceptions: {},
  selectedClassId: "",
  // [삭제] tests, testsMaster, selectedMonth
  selectedStudentIds: new Set(),
  selectedStudentName: "",
  editingPlanId: null,
};

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  // --- 기존 초기화 로직 ---
  state.classes = await api("/api/class");
  const classOptions = state.classes
    .map(
      (c) => `<option value="${c.id}">${c.name} (${c.schedule_days})</option>`
    )
    .join("");
  $("#selClass").innerHTML = classOptions;
  $("#selClassInfo").innerHTML = classOptions;

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

  // [삭제] 시험 마스터 목록 로딩 로직

  // --- 이벤트 핸들러 연결 ---
  $("#selClass").onchange = onClassChange;
  $("#selClassInfo").onchange = (e) => {
    $("#selClass").value = e.target.value;
    onClassChange();
  };

  $("#btnAddMain1").onclick = () => addToLane("main1", $("#selMain1").value);
  $("#btnAddMain2").onclick = () => addToLane("main2", $("#selMain2").value);
  $("#btnAddVocab").onclick = () => addToLane("vocab", $("#selVocab").value);

  $("#btnPreview").onclick = previewPlan;
  $("#btnSave").onclick = savePlan;
  $("#btnPrint").onclick = () => window.print();

  const today = new Date().toISOString().slice(0, 10);
  $("#startDate").value = today;
  $("#endDate").value = today;

  // [삭제] 월 네비게이터 및 시험 추가 이벤트 핸들러

  // [수정] 모달/관리 버튼 이벤트 핸들러
  $("#btnManagePlans").onclick = openPlanActionModalForSelectedStudent;
  $("#btnAddNewPlan").onclick = () => {
    closePlanActionModal();
    clearPlanSettings();
    updateStatusMessage(
      `📝 ${state.selectedStudentName} 학생의 새 플랜을 생성합니다.`
    );
    $("#btnSave").textContent = "저장하기";
  };
  $("#btnCancelModal").onclick = () => {
    closePlanActionModal();
  };

  await onClassChange();
}

// --- UI 렌더링 및 상태 관리 함수 ---
function clearPlanSettings() {
  state.lanes = { main1: [], main2: [], vocab: [] };
  renderLane("main1");
  renderLane("main2");
  renderLane("vocab");
  const today = new Date().toISOString().slice(0, 10);
  $("#startDate").value = today;
  $("#endDate").value = today;
  $("#customDays").value = "";
  state.exceptions = {};
  state.editingPlanId = null;
  $("#result").innerHTML = "옵션을 선택한 뒤 ‘미리보기’를 눌러주세요.";
}

function updateStatusMessage(message, isVisible = true) {
  const el = $("#planStatus");
  if (isVisible && message) {
    el.textContent = message;
    el.style.display = "block";
  } else {
    el.style.display = "none";
  }
}

function renderStudentSelection() {
  const checkboxes = document.querySelectorAll(
    '#studentList input[name="student"]'
  );
  checkboxes.forEach((cb) => {
    cb.checked = state.selectedStudentIds.has(cb.value);
  });
}

// --- 핵심 로직: 반/학생 변경 ---
async function onClassChange() {
  const classId = $("#selClass").value;
  state.selectedClassId = classId;
  $("#selClassInfo").value = classId;
  clearPlanSettings();
  state.selectedStudentIds.clear();
  updateStatusMessage("", false);
  $("#btnManagePlans").style.display = "none";

  const studentListEl = $("#studentList");
  studentListEl.innerHTML = "";

  if (!classId) {
    // [삭제] testList 초기화
    return;
  }

  const res = await api(`/api/student?classId=${encodeURIComponent(classId)}`);
  const students = res?.students || [];

  if (students.length > 0) {
    const planChecks = await Promise.all(
      students.map((s) =>
        api(`/api/plans?studentId=${s.id}`)
          .then((r) => r.plans.length > 0)
          .catch(() => false)
      )
    );

    studentListEl.innerHTML = students
      .map(
        (s, i) => `
        <label style="display: block; padding: 4px; border-radius: 8px; cursor: pointer;">
          <input type="checkbox" name="student" value="${s.id}" data-name="${
          s.name
        }" data-has-plan="${planChecks[i]}">
          ${s.name} (${s.school} ${s.grade}) ${planChecks[i] ? "💾" : ""}
        </label>`
      )
      .join("");

    studentListEl
      .querySelectorAll('input[name="student"]')
      .forEach((checkbox) => {
        checkbox.onchange = (e) => {
          if (e.target.checked) state.selectedStudentIds.add(e.target.value);
          else state.selectedStudentIds.delete(e.target.value);
          onStudentSelectionChange();
        };
      });
  } else {
    studentListEl.innerHTML = `<div class="muted" style="padding:10px;">학생이 없습니다.</div>`;
  }
  // [삭제] reloadTests() 호출
}

// [대규모 수정] onStudentSelectionChange 로직 변경
async function onStudentSelectionChange() {
  const count = state.selectedStudentIds.size;
  const studentIds = Array.from(state.selectedStudentIds);
  const saveButton = $("#btnSave");
  const manageButton = $("#btnManagePlans");

  manageButton.style.display = "none";

  if (count === 0) {
    updateStatusMessage("", false);
    saveButton.textContent = "저장하기";
    clearPlanSettings();
    return;
  }

  if (count > 1) {
    const studentNames = studentIds
      .map((id) => $(`#studentList input[value="${id}"]`).dataset.name)
      .join(", ");
    updateStatusMessage(
      `📝 ${studentNames} 학생들의 새 공통 플랜을 생성합니다.`
    );
    saveButton.textContent = "저장하기";
    clearPlanSettings();
    return;
  }

  if (count === 1) {
    const studentId = studentIds[0];
    const checkbox = $(`#studentList input[value="${studentId}"]`);
    const studentName = checkbox.dataset.name;
    const hasPlan = checkbox.dataset.hasPlan === "true";

    state.selectedStudentName = studentName;

    if (hasPlan) {
      manageButton.style.display = "block";
      updateStatusMessage(
        `ℹ️ ${studentName} 학생의 기존 플랜을 관리하거나, 새 플랜을 만들 수 있습니다.`
      );
      saveButton.textContent = "새 플랜 저장하기";
    } else {
      updateStatusMessage(`📝 ${studentName} 학생의 새 플랜을 생성합니다.`);
      saveButton.textContent = "저장하기";
    }
    clearPlanSettings();
  }
}

// --- 모달 관리 ---
async function openPlanActionModalForSelectedStudent() {
  const studentId = Array.from(state.selectedStudentIds)[0];
  if (!studentId) return;

  try {
    const studentName = $(`#studentList input[value="${studentId}"]`).dataset
      .name;
    const res = await api(`/api/plans?studentId=${studentId}`);
    openPlanActionModal(studentName, res.plans);
  } catch (e) {
    alert(`플랜 조회 실패: ${e.message}`);
  }
}

function openPlanActionModal(studentName, plans) {
  $("#modalStudentName").textContent = `${studentName} 학생 플랜 관리`;
  const listEl = $("#existingPlansList");
  listEl.innerHTML =
    plans.length > 0
      ? plans
          .map(
            (p) => `
    <div class="plan-list-item">
      <span>${p.context.startDate} ~ ${p.context.endDate}</span>
      <div>
        <button class="btn-xs" onclick="loadPlanForEditing('${p.planId}', '${p.studentId}')">수정</button>
        <button class="btn-xs" style="background:#ef4444" onclick="deletePlan('${p.planId}', '${p.studentId}')">삭제</button>
      </div>
    </div>
  `
          )
          .join("")
      : `<div class="muted" style="padding:10px;">저장된 플랜이 없습니다.</div>`;
  $("#planActionModal").style.display = "flex";
}

function closePlanActionModal() {
  $("#planActionModal").style.display = "none";
}

async function loadPlanForEditing(planId, studentId) {
  try {
    const res = await api(`/api/plans?studentId=${studentId}`);
    const plan = res.plans.find((p) => p.planId === planId);
    if (!plan) throw new Error("플랜을 찾을 수 없습니다.");

    const lanesConfig = plan.context.lanes || {
      main1: [],
      main2: [],
      vocab: [],
    };
    const reconstructedLanes = { main1: [], main2: [], vocab: [] };

    for (const lane of ["main1", "main2", "vocab"]) {
      for (const book of lanesConfig[lane]) {
        const materialInfo = state.materials.find(
          (m) => m.material_id === book.materialId
        );
        if (!materialInfo) continue;

        const isVocab = lane === "vocab";
        const units = await api(
          isVocab
            ? `/api/vocaBook?materialId=${encodeURIComponent(book.materialId)}`
            : `/api/mainBook?materialId=${encodeURIComponent(book.materialId)}`
        );

        if (!Array.isArray(units) || units.length === 0) continue;

        reconstructedLanes[lane].push({
          instanceId: `inst_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 7)}`,
          materialId: book.materialId,
          title: materialInfo.title,
          units: units,
          startUnitCode: book.startUnitCode,
          endUnitCode: book.endUnitCode,
        });
      }
    }
    state.lanes = reconstructedLanes;

    $("#startDate").value = plan.context.startDate;
    $("#endDate").value = plan.context.endDate;
    $("#customDays").value = plan.context.days;

    renderLane("main1");
    renderLane("main2");
    renderLane("vocab");

    state.exceptions = (plan.context.userSkips || []).reduce((acc, skip) => {
      acc[skip.date] = { type: skip.type, reason: skip.reason };
      return acc;
    }, {});

    state.editingPlanId = planId;
    $("#btnSave").textContent = "수정 내용 저장";
    updateStatusMessage(
      `🔄 ${state.selectedStudentName} 학생의 플랜을 수정합니다. (${plan.context.startDate} ~ ${plan.context.endDate})`
    );
    closePlanActionModal();
  } catch (e) {
    alert(`플랜 불러오기 실패: ${e.message}`);
  }
}

async function deletePlan(planId, studentId) {
  if (!confirm("정말 이 플랜을 삭제하시겠습니까? 되돌릴 수 없습니다.")) return;
  try {
    await api(`/api/plans?planId=${planId}&studentId=${studentId}`, {
      method: "DELETE",
    });
    alert("플랜이 삭제되었습니다.");
    closePlanActionModal();
    await onClassChange();
    state.selectedStudentIds.clear();
    onStudentSelectionChange();
  } catch (e) {
    alert(`삭제 실패: ${e.message}`);
  }
}
window.loadPlanForEditing = loadPlanForEditing;
window.deletePlan = deletePlan;

// --- 저장 및 미리보기 ---
async function savePlan() {
  const studentIds = Array.from(state.selectedStudentIds);
  if (studentIds.length === 0) return alert("저장할 학생을 선택하세요.");

  const students = studentIds.map((id) => ({
    id,
    name: $(`#studentList input[value="${id}"]`).dataset.name,
  }));

  const lanesData = {
    main1: state.lanes.main1.map((b) => ({
      materialId: b.materialId,
      startUnitCode: b.startUnitCode,
      endUnitCode: b.endUnitCode,
    })),
    main2: state.lanes.main2.map((b) => ({
      materialId: b.materialId,
      startUnitCode: b.startUnitCode,
      endUnitCode: b.endUnitCode,
    })),
    vocab: state.lanes.vocab.map((b) => ({
      materialId: b.materialId,
      startUnitCode: b.startUnitCode,
      endUnitCode: b.endUnitCode,
    })),
  };
  const userSkipsData = Object.entries(state.exceptions).map(([date, v]) => ({
    date,
    type: v.type,
    reason: v.reason || "",
  }));

  const body = {
    classId: state.selectedClassId,
    startDate: $("#startDate").value,
    endDate: $("#endDate").value,
    days: (
      $("#customDays").value ||
      state.classes.find((c) => c.id === state.selectedClassId)
        ?.schedule_days ||
      "MON,WED,FRI"
    ).toUpperCase(),
    lanes: lanesData,
    userSkips: userSkipsData,
  };

  try {
    if (state.editingPlanId) {
      body.studentId = studentIds[0];
      await api(`/api/plans?planId=${state.editingPlanId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      alert("플랜이 성공적으로 수정되었습니다.");
    } else {
      body.students = students;
      await api("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      alert("플랜이 성공적으로 저장되었습니다.");
    }
    await onClassChange();
    state.selectedStudentIds.clear();
    onStudentSelectionChange();
  } catch (e) {
    alert(`저장/수정 실패: ${e.message}`);
  }
}

async function previewPlan() {
  const studentIds = Array.from(state.selectedStudentIds);
  if (studentIds.length === 0) return alert("미리보기 할 학생을 선택하세요.");

  const studentNames = studentIds.map(
    (id) => $(`#studentList input[value="${id}"]`).dataset.name
  );
  const startDate = $("#startDate").value;
  const endDate = $("#endDate").value;
  if (!startDate || !endDate) return alert("시작/끝 날짜를 선택하세요.");

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

  try {
    const res = await api("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.error);
    renderPrintable(res.items, { studentNames, startDate, endDate });
  } catch (e) {
    $("#result").textContent = `생성 실패: ${e.message}`;
  }
}

function renderPrintable(items, ctx) {
  const dates = [...new Set(items.map((i) => i.date))].sort();
  const studentHeader = `<div style="margin-bottom:12px;"><b>${ctx.studentNames.join(
    ", "
  )}</b> / ${ctx.startDate} ~ ${ctx.endDate}</div>`;
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
  const materialsHeaderHtml = `<div class="materials-header">${usedMaterials
    .map(
      (m) =>
        `<div class="material-item"><div class="material-title">${
          m.title
        }</div><div class="material-lecture">${
          m.lecture || "인강 정보 없음"
        }</div></div>`
    )
    .join("")}</div>`;
  const thead = `
    <thead style="font-size: 12px; text-align: center;">
      <tr>
        <th rowspan="3" style="width:100px; vertical-align: middle;">날짜</th>
        <th colspan="5">수업 1</th> <th colspan="5">수업 2</th> <th colspan="2">단어 DT</th>
      </tr>
      <tr>
        <th colspan="3">수업 진도</th> <th colspan="2">티칭 챌린지</th>
        <th colspan="3">수업 진도</th> <th colspan="2">티칭 챌린지</th>
        <th rowspan="2" style="vertical-align: middle;">회차</th> <th rowspan="2" style="vertical-align: middle;">DT</th>
      </tr>
      <tr>
        <th>인강</th><th>교재 page</th><th>WB</th><th>개념+단어</th><th>문장학습</th>
        <th>인강</th><th>교재 page</th><th>WB</th><th>개념+단어</th><th>문장학습</th>
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
      if (skip)
        return `<tr><td ${tag}>${dateString}</td><td colspan="12" style="color:#64748b;background:#f8fafc;">${skip.reason}</td></tr>`;
      if (tests.length)
        return `<tr><td ${tag}>${dateString}</td><td colspan="12" style="background: #fffbe6;">${tests
          .map((t) => t.title)
          .join("<br>")}</td></tr>`;

      const m1 = dayItems.find(
        (x) => x.source === "main" && x.lane === "main1"
      );
      const m2 = dayItems.find(
        (x) => x.source === "main" && x.lane === "main2"
      );
      const v = dayItems.find((x) => x.source === "vocab");

      const renderMainLane = (mainItem) => {
        if (!mainItem) return `<td></td>`.repeat(5);
        const title =
          state.materials.find((m) => m.material_id === mainItem.material_id)
            ?.title || mainItem.material_id;
        if (mainItem.isOT)
          return `<td colspan="5" style="background: #F9FF00; border: 1px solid red; font-weight: bold;">"${title}" OT</td>`;
        if (mainItem.isReturn)
          return `<td colspan="5" style="background: #e0f2fe; border: 1px solid #0ea5e9; font-weight: bold;">"${title}" 복귀</td>`;
        return `<td>${mainItem.lecture_range || ""}</td><td>${
          mainItem.pages ? `p.${mainItem.pages}` : ""
        }</td><td>${mainItem.wb ? `p.${mainItem.wb}` : ""}</td><td>${
          mainItem.dt_vocab || ""
        }</td><td>${mainItem.key_sents || ""}</td>`;
      };
      const m1_html = renderMainLane(m1);
      const m2_html = renderMainLane(m2);
      return `<tr style="font-size: 14px;"><td ${tag}>${dateString}</td>${m1_html}${m2_html}<td>${
        v?.lecture_range || ""
      }</td><td>${v?.vocab_range || ""}</td></tr>`;
    })
    .join("");
  $(
    "#result"
  ).innerHTML = `${studentHeader}${materialsHeaderHtml}<table class="table">${thead}<tbody>${rows}</tbody></table>`;
  document.querySelectorAll(".js-date").forEach((el) => {
    el.onclick = () => openSkipModal(el.getAttribute("data-date"));
  });
}

// ... (addToLane, removeFromLane, move, renderLane, skipModal 등 나머지 함수는 이전과 동일)
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
window.removeFromLane = removeFromLane;
window.move = move;
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
            }>${u.unit_code} — ${u.lecture_range || u.title || ""}</option>`
        )
        .join("");
      const endOptions = b.units
        .slice(startIndex)
        .map(
          (u) =>
            `<option value="${u.unit_code}" ${
              u.unit_code === b.endUnitCode ? "selected" : ""
            }>${u.unit_code} — ${u.lecture_range || u.title || ""}</option>`
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
          <div style="flex:1"> <label class="small">시작 차시</label> <select data-type="start" data-lane="${lane}" data-id="${b.instanceId}">${startOptions}</select> </div>
          <div style="flex:1"> <label class="small">종료 차시</label> <select data-type="end" data-lane="${lane}" data-id="${b.instanceId}">${endOptions}</select> </div>
        </div>
      </div>`;
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
        if (startIndex > endIndex) book.endUnitCode = book.startUnitCode;
        renderLane(lane);
      } else {
        book.endUnitCode = e.target.value;
      }
    };
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
