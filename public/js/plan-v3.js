// /public/js/plan-v3.js — 신규 파일

const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

// API 호출 래퍼
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

// 디바운스 헬퍼
const debounce = (func, delay) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
};

// 전역 상태 객체
const state = {
  allStudents: [],
  allMaterials: [],
  allClasses: [],
  allEvents: [],
  selectedStudent: null,
  studentPlans: [],
  editingPlanId: null,
  lanes: { main1: [], main2: [], vocab: [] },
  userSkips: {},
};

document.addEventListener("DOMContentLoaded", boot);

// --- 1. 초기화 ---
async function boot() {
  try {
    const [studentsRes, materialsRes, classesRes, eventsRes] =
      await Promise.all([
        api("/api/student"),
        api("/api/materials"),
        api("/api/class"),
        api("/api/events"),
      ]);

    state.allStudents = studentsRes.students.sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    state.allMaterials = materialsRes;
    state.allClasses = classesRes;
    state.allEvents = eventsRes.events;

    renderStudentList();
    renderMaterialOptions();
    renderEvents();
    attachEventListeners();

    const today = new Date().toISOString().slice(0, 10);
    $("#startDate").value = today;
    $("#endDate").value = today;
  } catch (e) {
    console.error("초기화 실패:", e);
    alert(`페이지를 불러오는 데 실패했습니다: ${e.message}`);
  }
}

function attachEventListeners() {
  // 이벤트 관리
  $("#btnAddEventAll").onclick = () => addEvent("all");
  $("#btnAddEventScoped").onclick = () => addEvent("scoped");

  // 학생 검색
  $("#studentSearchInput").oninput = (e) => renderStudentList(e.target.value);

  // 플랜 관리
  $("#btnAddNewPlan").onclick = showPlanEditorForNewPlan;

  // 플랜 에디터
  $("#selMaterialCategory").onchange = renderMaterialOptions;
  $("#btnAddBook").onclick = addBookToLane;

  // 날짜, 요일 변경 시 자동 미리보기
  const debouncedPreview = debounce(triggerPreview, 500);
  $$("#startDate, #endDate, #customDays").forEach(
    (el) => (el.onchange = debouncedPreview)
  );

  // 저장/출력
  $("#btnSave").onclick = savePlan;
  $("#btnPrint").onclick = () => window.print();
}

// --- 2. 이벤트 관리 (전체/부분 설정) ---
function renderEvents() {
  const listEl = $("#eventList");
  if (!state.allEvents.length) {
    listEl.innerHTML = `<div class="muted">등록된 이벤트가 없습니다.</div>`;
    return;
  }
  const scopeMap = { all: "전체", school: "학교", grade: "학년", class: "반" };
  listEl.innerHTML = state.allEvents
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(
      (event) => `
      <div class="list-item">
        <span>[${scopeMap[event.scope] || "기타"}${
        event.scopeValue ? `:${event.scopeValue}` : ""
      }] ${event.date}: ${event.title}</span>
        <button class="btn-xs" style="background:#ef4444" onclick="deleteEvent('${
          event.id
        }')">삭제</button>
      </div>
    `
    )
    .join("");
}

async function addEvent(type) {
  const isAll = type === "all";
  const date = $(isAll ? "#eventDateAll" : "#eventDateScoped").value;
  const title = $(isAll ? "#eventTitleAll" : "#eventTitleScoped").value.trim();
  const scope = isAll ? "all" : $("#eventScope").value;
  const scopeValue = isAll ? "" : $("#eventScopeValue").value.trim();

  if (!date || !title) return alert("날짜와 내용을 입력하세요.");
  if (!isAll && !scopeValue)
    return alert("부분 설정 값을 입력하세요 (예: A중학교).");

  try {
    const { event } = await api("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, title, scope, scopeValue }),
    });
    state.allEvents.push(event);
    renderEvents();
    // 폼 초기화
    $(isAll ? "#eventDateAll" : "#eventDateScoped").value = "";
    $(isAll ? "#eventTitleAll" : "#eventTitleScoped").value = "";
    if (!isAll) $("#eventScopeValue").value = "";
    triggerPreview();
  } catch (e) {
    alert(`이벤트 추가 실패: ${e.message}`);
  }
}

async function deleteEvent(eventId) {
  if (!confirm("정말 이 이벤트를 삭제하시겠습니까?")) return;
  try {
    await api(`/api/events?eventId=${eventId}`, { method: "DELETE" });
    state.allEvents = state.allEvents.filter((e) => e.id !== eventId);
    renderEvents();
    triggerPreview();
  } catch (e) {
    alert(`삭제 실패: ${e.message}`);
  }
}
window.deleteEvent = deleteEvent; // 전역 스코프에 할당하여 onclick에서 호출 가능하게 함

// --- 3. 학생 선택 및 플랜 관리 ---
function renderStudentList(searchTerm = "") {
  const filtered = searchTerm
    ? state.allStudents.filter((s) =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : state.allStudents;

  $("#studentList").innerHTML = filtered
    .map(
      (s) =>
        `<label><input type="radio" name="student" value="${s.id}"> ${s.name} (${s.school} ${s.grade})</label>`
    )
    .join("");

  $$('input[name="student"]').forEach((radio) => {
    radio.onchange = onStudentSelect;
  });
}

async function onStudentSelect(e) {
  const studentId = e.target.value;
  state.selectedStudent = state.allStudents.find((s) => s.id === studentId);

  $(
    "#planConfigHeader"
  ).textContent = `플랜 설정 (${state.selectedStudent.name})`;
  $("#planActions").style.display = "block";
  $("#planEditor").style.display = "none";
  $("#result").innerHTML = "기존 플랜을 수정하거나 새 플랜을 만드세요.";

  try {
    const res = await api(`/api/plans?studentId=${studentId}`);
    state.studentPlans = res.plans || [];
    renderExistingPlans();
  } catch (e) {
    alert(`플랜 조회 실패: ${e.message}`);
    state.studentPlans = [];
    renderExistingPlans();
  }
}

function renderExistingPlans() {
  const listEl = $("#existingPlans");
  if (!state.studentPlans.length) {
    listEl.innerHTML = `<div class="muted" style="padding:10px;">저장된 플랜이 없습니다.</div>`;
    return;
  }
  listEl.innerHTML = state.studentPlans
    .map(
      (p) => `
        <div class="plan-list-item">
            <span>${p.context.startDate} ~ ${p.context.endDate}</span>
            <div>
                <button class="btn-xs" onclick="loadPlanForEditing('${p.planId}')">수정</button>
                <button class="btn-xs" style="background:#ef4444" onclick="deletePlan('${p.planId}')">삭제</button>
            </div>
        </div>
    `
    )
    .join("");
}

window.loadPlanForEditing = loadPlanForEditing;
window.deletePlan = deletePlan;

// --- 4. 플랜 에디터 ---
function showPlanEditorForNewPlan() {
  state.editingPlanId = null;
  clearPlanEditor();
  $("#planActions").style.display = "none";
  $("#planEditor").style.display = "block";
  $("#btnSave").textContent = "새 플랜 저장하기";
}

function clearPlanEditor() {
  state.lanes = { main1: [], main2: [], vocab: [] };
  state.userSkips = {};
  renderLane("main1");
  renderLane("main2");
  renderLane("vocab");
  const today = new Date().toISOString().slice(0, 10);
  $("#startDate").value = today;
  $("#endDate").value = today;
  $("#customDays").value = "";
  $("#result").innerHTML = "교재를 추가하고 기간을 설정하세요.";
}

// /public/js/plan-v3.js 파일의 renderMaterialOptions 함수

function renderMaterialOptions() {
  const selCat = $("#selMaterialCategory");
  const selSubCat = $("#selMaterialSubCategory");
  const selMat = $("#selMaterial");

  const uncategorized = state.allMaterials.filter((m) => !m.category);
  const categories = [
    ...new Set(
      state.allMaterials.filter((m) => m.category).map((m) => m.category)
    ),
  ];

  // 1. 카테고리 드롭다운 채우기
  let catOptions = categories.map((c) => `<option value="${c}">${c}</option>`);
  if (uncategorized.length > 0) {
    // 미분류 교재가 있으면 "(미분류 교재)" 옵션 추가
    catOptions.unshift(
      `<option value="--uncategorized--">(미분류 교재)</option>`
    );
  }
  selCat.innerHTML = catOptions.join("");

  // 2. 연쇄 동작 설정
  selCat.onchange = () => {
    const selectedCategory = selCat.value;

    if (selectedCategory === "--uncategorized--") {
      // (미분류 교재) 선택 시
      selSubCat.style.display = "none"; // 서브카테고리 숨김
      selMat.innerHTML = uncategorized
        .map((m) => `<option value="${m.material_id}">${m.title}</option>`)
        .join("");
    } else {
      // 실제 카테고리 선택 시
      selSubCat.style.display = "block"; // 서브카테고리 보임

      const materialsInCategory = state.allMaterials.filter(
        (m) => m.category === selectedCategory
      );
      const subcategories = [
        ...new Set(
          materialsInCategory
            .filter((m) => m.subcategory)
            .map((m) => m.subcategory)
        ),
      ];
      const noSubcategory = materialsInCategory.filter((m) => !m.subcategory);

      let subCatOptions = subcategories.map(
        (sc) => `<option value="${sc}">${sc}</option>`
      );
      if (noSubcategory.length > 0) {
        // 서브카테고리가 없는 교재가 있으면 "(바로 선택)" 옵션 추가
        subCatOptions.unshift(
          `<option value="--direct--">(바로 선택)</option>`
        );
      }
      selSubCat.innerHTML = subCatOptions.join("");
      selSubCat.onchange(); // 서브카테고리 변경 이벤트 즉시 실행
    }
  };

  selSubCat.onchange = () => {
    const selectedCategory = selCat.value;
    const selectedSubCategory = selSubCat.value;

    if (selectedCategory === "--uncategorized--") return;

    let materialsToShow = [];
    if (selectedSubCategory === "--direct--") {
      materialsToShow = state.allMaterials.filter(
        (m) => m.category === selectedCategory && !m.subcategory
      );
    } else {
      materialsToShow = state.allMaterials.filter(
        (m) =>
          m.category === selectedCategory &&
          m.subcategory === selectedSubCategory
      );
    }
    selMat.innerHTML = materialsToShow
      .map((m) => `<option value="${m.material_id}">${m.title}</option>`)
      .join("");
  };

  // 3. 초기 상태 설정
  if (selCat.options.length > 0) {
    selCat.onchange();
  } else {
    // 교재가 하나도 없을 경우
    selSubCat.style.display = "none";
    selMat.innerHTML = `<option value="">등록된 교재가 없습니다</option>`;
  }
}

async function addBookToLane() {
  const materialId = $("#selMaterial").value;
  const lane = $("#selLane").value;
  if (!materialId || !lane) return;

  try {
    const title =
      state.allMaterials.find((m) => m.material_id === materialId)?.title ||
      materialId;
    const isVocab = lane === "vocab";
    const units = await api(
      isVocab
        ? `/api/vocaBook?materialId=${materialId}`
        : `/api/mainBook?materialId=${materialId}`
    );
    if (!Array.isArray(units) || !units.length) {
      return alert("해당 교재의 차시 정보가 없습니다.");
    }

    state.lanes[lane].push({
      instanceId: `inst_${Date.now()}`,
      materialId,
      title,
      units,
      startUnitCode: units[0].unit_code,
      endUnitCode: units[units.length - 1].unit_code,
    });
    renderLane(lane);
    triggerPreview();
  } catch (e) {
    alert(`교재 추가 실패: ${e.message}`);
  }
}

function renderLane(lane) {
  const box = $(`#lane${lane.charAt(0).toUpperCase() + lane.slice(1)}`);
  const arr = state.lanes[lane];
  if (!arr.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML =
    `<h5>${lane}</h5>` +
    arr
      .map((b) => {
        const startOptions = b.units
          .map(
            (u) =>
              `<option value="${u.unit_code}" ${
                u.unit_code === b.startUnitCode ? "selected" : ""
              }>${u.lecture_range || u.lecture || ""} — ${
                u.title || ""
              }</option>`
          )
          .join("");
        const endOptions = b.units
          .map(
            (u) =>
              `<option value="${u.unit_code}" ${
                u.unit_code === b.endUnitCode ? "selected" : ""
              }>${u.lecture_range || u.lecture || ""} — ${
                u.title || ""
              }</option>`
          )
          .join("");
        return `
        <div class="book-card">
            <b>${b.title}</b>
            <div class="row mt">
              <div style="flex:1"> <label class="small">시작 차시</label> <select data-type="start" data-lane="${lane}" data-id="${b.instanceId}">${startOptions}</select> </div>
              <div style="flex:1"> <label class="small">종료 차시</label> <select data-type="end" data-lane="${lane}" data-id="${b.instanceId}">${endOptions}</select> </div>
            </div>
            <button class="btn-xs" style="background:#ef4444; width:auto; margin-top:8px;" onclick="removeFromLane('${lane}', '${b.instanceId}')">삭제</button>
        </div>`;
      })
      .join("");

  box.querySelectorAll("select").forEach((s) => (s.onchange = onUnitChange));
}

function onUnitChange(e) {
  const { type, lane, id } = e.target.dataset;
  const book = state.lanes[lane].find((b) => b.instanceId === id);
  if (!book) return;

  if (type === "start") book.startUnitCode = e.target.value;
  else book.endUnitCode = e.target.value;

  triggerPreview();
}

window.removeFromLane = (lane, instanceId) => {
  state.lanes[lane] = state.lanes[lane].filter(
    (b) => b.instanceId !== instanceId
  );
  renderLane(lane);
  triggerPreview();
};

// --- 5. 미리보기 및 저장 ---
const triggerPreview = debounce(async () => {
  if (!state.selectedStudent) return;

  const startDate = $("#startDate").value;
  const endDate = $("#endDate").value;
  if (!startDate || !endDate) return;

  const defaultSchedule =
    state.allClasses.find((c) => c.id === state.selectedStudent.class_id)
      ?.schedule_days || "MON,WED,FRI";

  const body = {
    startDate,
    endDate,
    days: ($("#customDays").value || defaultSchedule).toUpperCase(),
    lanes: {
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
    },
    userSkips: Object.entries(state.userSkips).map(([date, v]) => ({
      date,
      type: v.type,
      reason: v.reason,
    })),
    events: state.allEvents,
    studentInfo: state.selectedStudent,
  };

  try {
    const res = await api("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(res.error);
    renderPrintable(res.items, {
      studentNames: [state.selectedStudent.name],
      startDate,
      endDate,
    });
  } catch (e) {
    $(
      "#result"
    ).innerHTML = `<div class="muted">미리보기 생성 실패: ${e.message}</div>`;
  }
}, 500);

async function savePlan() {
  if (!state.selectedStudent) return alert("학생을 선택하세요.");

  const defaultSchedule =
    state.allClasses.find((c) => c.id === state.selectedStudent.class_id)
      ?.schedule_days || "MON,WED,FRI";
  const planConfig = {
    startDate: $("#startDate").value,
    endDate: $("#endDate").value,
    days: ($("#customDays").value || defaultSchedule).toUpperCase(),
    lanes: {
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
    },
    userSkips: Object.entries(state.userSkips).map(([date, v]) => ({
      date,
      type: v.type,
      reason: v.reason,
    })),
  };

  try {
    if (state.editingPlanId) {
      // 수정
      await api(`/api/plans?planId=${state.editingPlanId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...planConfig,
          studentId: state.selectedStudent.id,
        }),
      });
      alert("플랜이 수정되었습니다.");
    } else {
      // 생성
      await api("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...planConfig,
          students: [state.selectedStudent],
        }),
      });
      alert("플랜이 저장되었습니다.");
    }
    // 상태 초기화 및 목록 갱신
    const res = await api(`/api/plans?studentId=${state.selectedStudent.id}`);
    state.studentPlans = res.plans || [];
    renderExistingPlans();
    $("#planEditor").style.display = "none";
    $("#planActions").style.display = "block";
  } catch (e) {
    alert(`저장 실패: ${e.message}`);
  }
}

async function deletePlan(planId) {
  if (!confirm("정말 이 플랜을 삭제하시겠습니까?")) return;
  try {
    await api(
      `/api/plans?planId=${planId}&studentId=${state.selectedStudent.id}`,
      { method: "DELETE" }
    );
    alert("플랜이 삭제되었습니다.");
    state.studentPlans = state.studentPlans.filter((p) => p.planId !== planId);
    renderExistingPlans();
  } catch (e) {
    alert(`삭제 실패: ${e.message}`);
  }
}

function renderPrintable(items, ctx) {
  // 이전 버전과 거의 동일. tests 관련 코드만 없음.
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
    .map((id) => state.allMaterials.find((m) => m.material_id === id))
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
          <th colspan="5">메인 1</th> <th colspan="5">메인 2</th> <th colspan="2">단어 DT</th>
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
      const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"];
      const dateObj = new Date(d + "T00:00:00Z");
      const dayName = DOW_KR[dateObj.getUTCDay()];
      const dateString = `<b>${d.slice(2).replace(/-/g, ".")} (${dayName})</b>`;

      if (skip) {
        return `<tr><td>${dateString}</td><td colspan="12" style="color:#64748b;background:#f8fafc;">${skip.reason}</td></tr>`;
      }

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
          state.allMaterials.find((m) => m.material_id === mainItem.material_id)
            ?.title || mainItem.material_id;
        if (mainItem.isOT)
          return `<td colspan="5" style="background: #F9FF00;">"${title}" OT</td>`;
        if (mainItem.isReturn)
          return `<td colspan="5" style="background: #e0f2fe;">"${title}" 복귀</td>`;
        return `<td>${mainItem.lecture_range || ""}</td><td>${
          mainItem.pages ? `p.${mainItem.pages}` : ""
        }</td><td>${mainItem.wb ? `p.${mainItem.wb}` : ""}</td><td>${
          mainItem.dt_vocab || ""
        }</td><td>${mainItem.key_sents || ""}</td>`;
      };

      return `<tr><td>${dateString}</td>${renderMainLane(m1)}${renderMainLane(
        m2
      )}<td>${v?.lecture_range || ""}</td><td>${
        v?.vocab_range || ""
      }</td></tr>`;
    })
    .join("");

  $(
    "#result"
  ).innerHTML = `${studentHeader}${materialsHeaderHtml}<table class="table">${thead}<tbody>${rows}</tbody></table>`;
}

async function loadPlanForEditing(planId) {
  const plan = state.studentPlans.find((p) => p.planId === planId);
  if (!plan) return alert("플랜 정보를 찾을 수 없습니다.");

  clearPlanEditor();
  state.editingPlanId = planId;

  $("#startDate").value = plan.context.startDate;
  $("#endDate").value = plan.context.endDate;
  $("#customDays").value = plan.context.days;

  // Lanes 복원
  const lanesConfig = plan.context.lanes || {};
  for (const lane in lanesConfig) {
    for (const book of lanesConfig[lane]) {
      const materialInfo = state.allMaterials.find(
        (m) => m.material_id === book.materialId
      );
      if (!materialInfo) continue;

      const isVocab = lane === "vocab";
      const units = await api(
        isVocab
          ? `/api/vocaBook?materialId=${book.materialId}`
          : `/api/mainBook?materialId=${book.materialId}`
      );

      state.lanes[lane].push({
        instanceId: `inst_${Date.now()}_${Math.random()}`,
        materialId: book.materialId,
        title: materialInfo.title,
        units: units,
        startUnitCode: book.startUnitCode,
        endUnitCode: book.endUnitCode,
      });
    }
  }
  renderLane("main1");
  renderLane("main2");
  renderLane("vocab");

  // UserSkips 복원 (필요 시)
  state.userSkips = (plan.context.userSkips || []).reduce((acc, skip) => {
    acc[skip.date] = { type: skip.type, reason: skip.reason };
    return acc;
  }, {});

  $("#planActions").style.display = "none";
  $("#planEditor").style.display = "block";
  $("#btnSave").textContent = "수정 내용 저장";
  triggerPreview();
}
