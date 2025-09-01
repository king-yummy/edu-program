// /public/js/plan-v3.js — 최종 오류 수정본

const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

// (api, debounce 헬퍼 함수는 이전과 동일)
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
const debounce = (func, delay) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
};

const state = {
  allStudents: [],
  allMaterials: [],
  allClasses: [],
  allEvents: [],
  selectedStudent: null,
  studentPlans: [],
  editingPlanId: null,
  planSegments: [],
  userSkips: {},
  selectionStart: null,
  selectionEnd: null,
  isInsertionMode: false,
};

const triggerPreview = debounce(async () => {
  if (!state.selectedStudent) return;
  const allItems = [];
  if (state.planSegments.length === 0) {
    $("#result").innerHTML = "플랜 구간이 없습니다. 새 플랜을 만들어주세요.";
    return;
  }
  for (const segment of state.planSegments) {
    if (!segment.startDate || !segment.endDate) continue;
    const defaultSchedule =
      state.allClasses.find((c) => c.id === state.selectedStudent.class_id)
        ?.schedule_days || "MON,WED,FRI";
    const body = {
      startDate: segment.startDate,
      endDate: segment.endDate,
      days: (segment.days || defaultSchedule).toUpperCase(),
      lanes: segment.lanes,
      userSkips: Object.entries(state.userSkips).map(([date, v]) => ({
        date,
        ...v,
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
      if (res.ok) allItems.push(...res.items);
    } catch (e) {
      console.error("Preview failed for segment", segment.id, e);
    }
  }
  renderPrintable(
    allItems.sort((a, b) => a.date.localeCompare(b.date)),
    {
      studentNames: [state.selectedStudent.name],
      startDate: state.planSegments[0].startDate,
      endDate: state.planSegments[state.planSegments.length - 1].endDate,
    }
  );
}, 500);

document.addEventListener("DOMContentLoaded", boot);

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
    attachModalEventListeners();
  } catch (e) {
    console.error("초기화 실패:", e);
    alert(`페이지를 불러오는 데 실패했습니다: ${e.message}`);
  }
}

function attachEventListeners() {
  $("#btnAddEventAll").onclick = () => addEvent("all");
  $("#btnAddEventScoped").onclick = () => addEvent("scoped");
  $("#studentSearchInput").oninput = (e) => renderStudentList(e.target.value);
  $("#btnAddNewPlan").onclick = showPlanEditorForNewPlan;
  $("#selMaterialCategory").onchange = renderMaterialOptions;
  $("#btnAddBook").onclick = addBookToLane;
  $("#btnSave").onclick = savePlan;
  $("#btnPrint").onclick = () => window.print();
  $("#btnInsertMode").onclick = enterInsertionMode;
}

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
window.deleteEvent = deleteEvent;

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
    .map((p) => {
      let startDate, endDate;
      if (p.planSegments && p.planSegments.length > 0) {
        startDate = p.planSegments[0].startDate;
        endDate = p.planSegments[p.planSegments.length - 1].endDate;
      } else if (p.context) {
        startDate = p.context.startDate;
        endDate = p.context.endDate;
      } else {
        startDate = endDate = "날짜 정보 없음";
      }
      return `
        <div class="plan-list-item">
            <span>플랜 (${startDate} ~ ${endDate})</span>
            <div>
                <button class="btn-xs" onclick="loadPlanForEditing('${p.planId}')">수정</button>
                <button class="btn-xs" style="background:#ef4444" onclick="deletePlan('${p.planId}')">삭제</button>
            </div>
        </div>`;
    })
    .join("");
}

function showPlanEditorForNewPlan() {
  state.editingPlanId = null;
  clearPlanEditor();
  $("#planActions").style.display = "none";
  $("#planEditor").style.display = "block";
  $("#btnSave").textContent = "새 플랜 저장하기";
}

function clearPlanEditor() {
  const today = new Date().toISOString().slice(0, 10);
  state.planSegments = [
    {
      id: `seg_${Date.now()}`,
      startDate: today,
      endDate: today,
      days: "",
      lanes: { main1: [], main2: [], vocab: [] },
    },
  ];
  state.userSkips = {};
  renderAllLanes();
  $("#result").innerHTML = "교재를 추가하고 기간을 설정하세요.";
}

function renderAllLanes() {
  $("#laneMain1").innerHTML = "<h5>메인 1</h5>";
  $("#laneMain2").innerHTML = "<h5>메인 2</h5>";
  $("#laneVocab").innerHTML = "<h5>어휘</h5>";
  if (!state.planSegments) return;
  state.planSegments.forEach((segment) => {
    for (const lane in segment.lanes) {
      renderLane(lane, segment);
    }
  });
}

function renderLane(lane, segment) {
  const box = $(`#lane${lane.charAt(0).toUpperCase() + lane.slice(1)}`);
  const arr = segment.lanes[lane];
  if (!arr || !arr.length) return;

  const segmentHeader = `<div class="muted small" style="padding: 4px; background: #f8fafc;">${segment.startDate} ~ ${segment.endDate}</div>`;
  box.innerHTML +=
    segmentHeader +
    arr
      .map((b) => {
        // --- [수정] b.units가 없을 경우를 대비해 빈 배열로 처리 ---
        const units = b.units || [];
        const startOptions = units
          .map(
            (u) =>
              `<option value="${u.unit_code}" ${
                u.unit_code === b.startUnitCode ? "selected" : ""
              }>${u.lecture_range || u.lecture || ""} — ${
                u.title || ""
              }</option>`
          )
          .join("");
        const endOptions = units
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
              <div style="flex:1"> <label class="small">시작 차시</label> <select data-type="start" data-lane="${lane}" data-id="${b.instanceId}" data-segment-id="${segment.id}">${startOptions}</select> </div>
              <div style="flex:1"> <label class="small">종료 차시</label> <select data-type="end" data-lane="${lane}" data-id="${b.instanceId}" data-segment-id="${segment.id}">${endOptions}</select> </div>
            </div>
            <button class="btn-xs" style="background:#ef4444; width:auto; margin-top:8px;" onclick="removeFromLane('${segment.id}', '${lane}', '${b.instanceId}')">삭제</button>
        </div>`;
      })
      .join("");
  box.querySelectorAll("select").forEach((s) => (s.onchange = onUnitChange));
}

function renderMaterialOptions() {
  const selCat = $("#selMaterialCategory"),
    selSubCat = $("#selMaterialSubCategory"),
    selMat = $("#selMaterial");
  const uncategorized = state.allMaterials.filter((m) => !m.category);
  const categories = [
    ...new Set(
      state.allMaterials.filter((m) => m.category).map((m) => m.category)
    ),
  ];
  let catOptions = categories.map((c) => `<option value="${c}">${c}</option>`);
  if (uncategorized.length > 0) {
    catOptions.unshift(
      `<option value="--uncategorized--">(미분류 교재)</option>`
    );
  }
  selCat.innerHTML = catOptions.join("");
  selCat.onchange = () => {
    const selectedCategory = selCat.value;
    if (selectedCategory === "--uncategorized--") {
      selSubCat.style.display = "none";
      selMat.innerHTML = uncategorized
        .map((m) => `<option value="${m.material_id}">${m.title}</option>`)
        .join("");
    } else {
      selSubCat.style.display = "block";
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
        subCatOptions.unshift(
          `<option value="--direct--">(바로 선택)</option>`
        );
      }
      selSubCat.innerHTML = subCatOptions.join("");
      selSubCat.onchange();
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
  if (selCat.options.length > 0) selCat.onchange();
  else {
    selSubCat.style.display = "none";
    selMat.innerHTML = `<option value="">등록된 교재가 없습니다</option>`;
  }
}

let lastSelectedDate = null;
window.handleDateClick = (event, date) => {
  if (event.shiftKey && lastSelectedDate) {
    state.selectionStart = lastSelectedDate < date ? lastSelectedDate : date;
    state.selectionEnd = lastSelectedDate < date ? date : lastSelectedDate;
  } else {
    state.selectionStart = state.selectionEnd = lastSelectedDate = date;
  }
  updateSelectionUI();
};
function updateSelectionUI() {
  $$("#result tr[data-date]").forEach((row) => {
    const date = row.dataset.date;
    row.style.backgroundColor =
      state.selectionStart &&
      date >= state.selectionStart &&
      date <= state.selectionEnd
        ? "#e0f2fe"
        : "";
  });
  if (state.selectionStart) {
    const start = new Date(state.selectionStart),
      end = new Date(state.selectionEnd);
    const diffDays =
      Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;
    $("#insertionControls").style.display = "block";
    $(
      "#btnInsertMode"
    ).textContent = `📝 선택한 ${diffDays}일 기간에 새 교재 삽입하기`;
  } else {
    $("#insertionControls").style.display = "none";
  }
}
function enterInsertionMode() {
  alert("교재 삽입 기능은 데모 버전입니다.");
}
async function addBookToLane() {
  alert("교재 추가 기능은 데모 버전입니다.");
}
async function savePlan() {
  alert("저장 기능은 데모 버전입니다.");
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
window.deletePlan = deletePlan;

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
        <tr><th rowspan="3" style="width:100px; vertical-align: middle;">날짜</th><th colspan="5">메인 1</th> <th colspan="5">메인 2</th> <th colspan="2">단어 DT</th></tr>
        <tr><th colspan="3">수업 진도</th> <th colspan="2">티칭 챌린지</th><th colspan="3">수업 진도</th> <th colspan="2">티칭 챌린지</th><th rowspan="2" style="vertical-align: middle;">회차</th> <th rowspan="2" style="vertical-align: middle;">DT</th></tr>
        <tr><th>인강</th><th>교재 page</th><th>WB</th><th>개념+단어</th><th>문장학습</th><th>인강</th><th>교재 page</th><th>WB</th><th>개념+단어</th><th>문장학습</th></tr>
      </thead>`;
  const rows = dates
    .map((d) => {
      const dayItems = items.filter((x) => x.date === d);
      const skip = dayItems.find((x) => x.source === "skip");
      const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"];
      const dateObj = new Date(d + "T00:00:00Z");
      const dayName = DOW_KR[dateObj.getUTCDay()];
      const dateString = `<b>${d.slice(2).replace(/-/g, ".")} (${dayName})</b>`;
      const tag = `data-date="${d}" onclick="handleDateClick(event, '${d}')" style="cursor:pointer;"`;
      if (skip) {
        return `<tr ${tag}><td >${dateString}</td><td colspan="12" style="color:#64748b;background:#f8fafc;">${skip.reason}</td></tr>`;
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
      return `<tr ${tag}><td>${dateString}</td>${renderMainLane(
        m1
      )}${renderMainLane(m2)}<td>${v?.lecture_range || ""}</td><td>${
        v?.vocab_range || ""
      }</td></tr>`;
    })
    .join("");
  $(
    "#result"
  ).innerHTML = `${studentHeader}${materialsHeaderHtml}<table class="table">${thead}<tbody>${rows}</tbody></table>`;
  updateSelectionUI();
}

// --- [수정] loadPlanForEditing 함수 최종본 ---
async function loadPlanForEditing(planId) {
  const plan = state.studentPlans.find((p) => p.planId === planId);
  if (!plan) return alert("플랜 정보를 찾을 수 없습니다.");

  clearPlanEditor();
  state.editingPlanId = planId;

  let segmentsToLoad = [];
  // 옛날/새로운 데이터 형식 모두 호환
  if (plan.planSegments && plan.planSegments.length > 0) {
    segmentsToLoad = plan.planSegments;
  } else if (plan.context) {
    // 옛날 데이터 형식 변환
    segmentsToLoad = [
      {
        id: `seg_${Date.now()}`,
        startDate: plan.context.startDate,
        endDate: plan.context.endDate,
        days: plan.context.days,
        lanes: plan.context.lanes,
      },
    ];
  }

  // 각 교재의 상세 'units' 정보를 다시 불러와 채워넣습니다.
  for (const segment of segmentsToLoad) {
    for (const lane in segment.lanes) {
      for (const book of segment.lanes[lane]) {
        const isVocab = lane === "vocab";
        const units = await api(
          isVocab
            ? `/api/vocaBook?materialId=${book.materialId}`
            : `/api/mainBook?materialId=${book.materialId}`
        );
        book.units = units; // 'units' 정보 주입
        // title 정보도 다시 채워넣기
        const materialInfo = state.allMaterials.find(
          (m) => m.material_id === book.materialId
        );
        if (materialInfo) book.title = materialInfo.title;
      }
    }
  }
  state.planSegments = segmentsToLoad;

  // userSkips 데이터 형식 변환 및 로드
  if (plan.context && Array.isArray(plan.context.userSkips)) {
    state.userSkips = plan.context.userSkips.reduce((acc, skip) => {
      acc[skip.date] = { type: skip.type, reason: skip.reason };
      return acc;
    }, {});
  } else {
    state.userSkips = plan.userSkips || {};
  }

  renderAllLanes();
  $("#planActions").style.display = "none";
  $("#planEditor").style.display = "block";
  $("#btnSave").textContent = "수정 내용 저장";
  triggerPreview();
}
window.loadPlanForEditing = loadPlanForEditing;

function attachModalEventListeners() {
  $$("#skipModal [data-type]").forEach((btn) => {
    btn.onclick = () => saveSkip(btn.dataset.type);
  });
  $("#btnSkipSave").onclick = () => saveSkip("other");
  $("#btnSkipDelete").onclick = deleteSkip;
  $("#btnSkipClose").onclick = closeSkipModal;
}
function openSkipModal(date) {
  const modal = $("#skipModal");
  modal.dataset.date = date;
  $("#skipDateLabel").textContent = `날짜: ${date}`;
  const existingSkip = state.userSkips[date];
  $("#skipReason").value =
    existingSkip?.type === "other" ? existingSkip.reason : "";
  modal.style.display = "flex";
}
window.openSkipModal = openSkipModal;
function closeSkipModal() {
  $("#skipModal").style.display = "none";
}
function saveSkip(type) {
  const date = $("#skipModal").dataset.date;
  const reason = $("#skipReason").value.trim();
  if (type === "other" && !reason) {
    return alert("기타 사유를 입력해주세요.");
  }
  state.userSkips[date] = {
    type,
    reason: type === "other" ? reason : type === "vacation" ? "휴가" : "질병",
  };
  closeSkipModal();
  triggerPreview();
}
function deleteSkip() {
  const date = $("#skipModal").dataset.date;
  delete state.userSkips[date];
  closeSkipModal();
  triggerPreview();
}
