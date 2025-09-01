// /public/js/plan-v3.js — 최종 수정본

const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

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
  insertionSegmentId: null, // ★ 수정됨: 삽입 중인 구간 ID를 기억
};

const triggerPreview = debounce(async () => {
  if (!state.selectedStudent) return;
  const allItems = [];
  if (!state.planSegments || state.planSegments.length === 0) {
    $("#result").innerHTML = "플랜 구간이 없습니다. 새 플랜을 만들어주세요.";
    return;
  }
  for (const segment of state.planSegments) {
    if (
      !segment.startDate ||
      !segment.endDate ||
      segment.startDate > segment.endDate
    )
      continue;
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
  const finalStartDate = state.planSegments[0]?.startDate;
  const finalEndDate =
    state.planSegments[state.planSegments.length - 1]?.endDate;
  renderPrintable(
    allItems.sort((a, b) => a.date.localeCompare(b.date)),
    {
      studentNames: [state.selectedStudent.name],
      startDate: finalStartDate,
      endDate: finalEndDate,
    }
  );
}, 500);

function updatePlanSegmentDetails() {
  if (state.planSegments.length > 0 && state.selectedStudent) {
    // 가장 첫 번째 구간의 시작일을 업데이트합니다.
    state.planSegments[0].startDate = $("#startDate").value;

    // 가장 마지막 구간의 종료일을 업데이트합니다.
    const lastSegment = state.planSegments[state.planSegments.length - 1];
    lastSegment.endDate = $("#endDate").value;

    // 요일 설정은 모든 구간에 동일하게 적용합니다.
    const defaultSchedule =
      state.allClasses.find((c) => c.id === state.selectedStudent.class_id)
        ?.schedule_days || "MON,WED,FRI";
    const newDays = $("#customDays").value || defaultSchedule;
    for (const segment of state.planSegments) {
      segment.days = newDays;
    }

    // 변경된 내용으로 UI와 미리보기를 다시 렌더링합니다.
    renderAllLanes();
    document.dispatchEvent(new Event("renderLanesComplete"));
    triggerPreview();
  }
}
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
  $("#btnInsertMode").onclick = toggleInsertionMode;
  // ▼▼▼ [추가] 아래 3줄을 추가하세요. ▼▼▼
  $("#startDate").onchange = updatePlanSegmentDetails;
  $("#endDate").onchange = updatePlanSegmentDetails;
  $("#customDays").oninput = updatePlanSegmentDetails;
  // ▲▲▲ [추가] 여기까지 ▲▲▲
}

// --- 이벤트 관리 (변경 없음) ---
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

// --- 학생 및 플랜 목록 관리 (변경 없음) ---
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

// ▼▼▼ [수정] 아래 두 함수를 통째로 바꿔주세요. ▼▼▼
function showPlanEditorForNewPlan() {
  state.editingPlanId = null;

  // 1. UI에 기본값 설정
  const today = new Date().toISOString().slice(0, 10);
  $("#startDate").value = today;
  $("#endDate").value = today;
  const defaultSchedule = state.selectedStudent
    ? state.allClasses.find((c) => c.id === state.selectedStudent.class_id)
        ?.schedule_days || "MON,WED,FRI"
    : "MON,WED,FRI";
  $("#customDays").value = defaultSchedule;

  // 2. UI 값으로 state 초기화 (clearPlanEditor의 핵심 기능 이전)
  state.planSegments = [
    {
      id: `seg_${Date.now()}`,
      startDate: $("#startDate").value,
      endDate: $("#endDate").value,
      days: defaultSchedule,
      lanes: { main1: [], main2: [], vocab: [] },
    },
  ];
  state.userSkips = {};

  // 3. 화면 업데이트 및 에디터 표시
  renderAllLanes();
  document.dispatchEvent(new Event("renderLanesComplete"));
  $("#result").innerHTML = "교재를 추가하고 기간을 설정하세요.";
  $("#planActions").style.display = "none";
  $("#planEditor").style.display = "block";
  $("#btnSave").textContent = "새 플랜 저장하기";
  triggerPreview();
}

function clearPlanEditor() {
  // 이 함수의 내용은 대부분 showPlanEditorForNewPlan으로 옮겨졌습니다.
  // 이젠 최소한의 정리만 수행하도록 단순화하거나,
  // showPlanEditorForNewPlan 호출로 대체해도 무방합니다.
  state.planSegments = [];
  state.userSkips = {};
  renderAllLanes();
}
// ▲▲▲ [수정] 여기까지 ▲▲▲

function renderAllLanes() {
  const laneContents = {
    main1: "<h5>메인 1</h5>",
    main2: "<h5>메인 2</h5>",
    vocab: "<h5>어휘</h5>",
  };
  if (state.planSegments) {
    state.planSegments.forEach((segment) => {
      for (const lane in segment.lanes) {
        const laneHTML = renderLane(lane, segment);
        if (laneHTML) {
          laneContents[lane] += laneHTML;
        }
      }
    });
  }
  $("#laneMain1").innerHTML = laneContents.main1;
  $("#laneMain2").innerHTML = laneContents.main2;
  $("#laneVocab").innerHTML = laneContents.vocab;
}
function renderLane(lane, segment) {
  const arr = segment.lanes[lane];
  if (!arr || !arr.length) return "";
  const segmentHeader = `<div class="muted small" style="padding: 4px; background: #f8fafc;">${segment.startDate} ~ ${segment.endDate}</div>`;
  const booksHTML = arr
    .map((b) => {
      const units = b.units || [];
      const startOptions = units
        .map(
          (u) =>
            `<option value="${u.unit_code}" ${
              u.unit_code === b.startUnitCode ? "selected" : ""
            }>${u.lecture_range || u.lecture || ""} — ${u.title || ""}</option>`
        )
        .join("");
      const endOptions = units
        .map(
          (u) =>
            `<option value="${u.unit_code}" ${
              u.unit_code === b.endUnitCode ? "selected" : ""
            }>${u.lecture_range || u.lecture || ""} — ${u.title || ""}</option>`
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
  return segmentHeader + booksHTML;
}
document.addEventListener("renderLanesComplete", () => {
  $$("#laneMain1 select, #laneMain2 select, #laneVocab select").forEach(
    (s) => (s.onchange = onUnitChange)
  );
});
function onUnitChange(e) {
  const { type, lane, id, segmentId } = e.target.dataset;
  const segment = state.planSegments.find((s) => s.id === segmentId);
  if (!segment) return;
  const book = segment.lanes[lane].find((b) => b.instanceId === id);
  if (!book) return;
  if (type === "start") {
    book.startUnitCode = e.target.value;
  } else {
    book.endUnitCode = e.target.value;
  }
  triggerPreview();
}
window.removeFromLane = (segmentId, lane, instanceId) => {
  const segment = state.planSegments.find((s) => s.id === segmentId);
  if (segment) {
    segment.lanes[lane] = segment.lanes[lane].filter(
      (b) => b.instanceId !== instanceId
    );
    renderAllLanes();
    document.dispatchEvent(new Event("renderLanesComplete"));
    triggerPreview();
  }
};
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
    const selectedCategory = selCat.value,
      selectedSubCategory = selSubCat.value;
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

// --- ★★★ 여기가 핵심 수정 부분 ★★★ ---

let lastSelectedDate = null;

window.handleDateClick = (event, date) => {
  if (state.isInsertionMode) return; // 삽입 모드 중에는 클릭 방지

  // 이전에 선택된 범위가 있거나, 아직 아무것도 선택하지 않았다면 새로 선택을 시작합니다.
  const isNewSelection =
    !state.selectionStart ||
    (state.selectionStart &&
      state.selectionEnd &&
      state.selectionStart !== state.selectionEnd);

  if (isNewSelection) {
    // 새로운 시작점을 설정합니다.
    state.selectionStart = date;
    state.selectionEnd = date;
  } else {
    // 두 번째 클릭으로 범위를 완성합니다.
    const firstClickDate = state.selectionStart;

    // 두 번째 클릭한 날짜가 첫 번째 클릭보다 이전이면, 두 값을 교체해줍니다.
    if (date < firstClickDate) {
      state.selectionStart = date;
      state.selectionEnd = firstClickDate;
    } else {
      state.selectionEnd = date;
    }
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
  if (state.selectionStart && !state.isInsertionMode) {
    const start = new Date(state.selectionStart),
      end = new Date(state.selectionEnd);
    const diffDays =
      Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;
    $("#insertionControls").style.display = "block";
    $(
      "#btnInsertMode"
    ).textContent = `📝 선택한 ${diffDays}일 기간에 새 교재 삽입하기`;
  } else if (!state.isInsertionMode) {
    $("#insertionControls").style.display = "none";
  }
}

// ★ 신규: 삽입 모드 진입/종료를 관리하는 함수
async function toggleInsertionMode() {
  if (state.isInsertionMode) {
    // --- 삽입 모드 종료 ---
    alert("교재 삽입을 완료했습니다.");
    exitInsertionMode();
  } else {
    // --- 삽입 모드 진입 ---
    if (!state.selectionStart) {
      return alert("먼저 미리보기에서 기간을 선택해주세요.");
    }

    const { start, end, targetSegment } = findTargetSegmentForInsertion();
    if (!targetSegment) {
      alert("교재를 삽입할 플랜 구간을 찾을 수 없습니다.");
      return;
    }

    try {
      // 1. 계획표를 '이전' - '삽입' - '이후' 3조각으로 딱 한 번만 자른다.
      const itemsBefore = await getPlanItems(
        targetSegment.startDate,
        getPreviousDay(start),
        targetSegment
      );
      const lanesAfter = JSON.parse(JSON.stringify(targetSegment.lanes));
      const lastItemByLane = { main1: null, main2: null, vocab: null };
      itemsBefore
        .filter((item) => item.source !== "skip" && item.lane)
        .forEach((item) => {
          lastItemByLane[item.lane] = item;
        });
      for (const lane in lastItemByLane) {
        const lastItem = lastItemByLane[lane];
        if (lastItem) {
          const laneDataAfter = lanesAfter[lane];
          const bookIndex = laneDataAfter.findIndex(
            (b) => b.materialId === lastItem.material_id
          );
          if (bookIndex > -1) {
            const book = laneDataAfter[bookIndex];
            const lastUnitIndex = book.units.findIndex(
              (u) => u.unit_code === lastItem.unit_code
            );
            if (lastUnitIndex > -1 && lastUnitIndex + 1 < book.units.length) {
              book.startUnitCode = book.units[lastUnitIndex + 1].unit_code;
            } else {
              laneDataAfter.splice(bookIndex, 1);
            }
          }
        }
      }

      const beforeSegment = {
        ...targetSegment,
        id: `seg_${Date.now()}_before`,
        endDate: getPreviousDay(start),
      };
      const insertionSegment = {
        id: `seg_${Date.now()}_insertion`,
        startDate: start,
        endDate: end,
        days: targetSegment.days,
        lanes: { main1: [], main2: [], vocab: [] }, // 완전히 빈 삽입 구간
      };
      const afterSegment = {
        ...targetSegment,
        id: `seg_${Date.now()}_after`,
        startDate: getNextDay(end),
        lanes: lanesAfter,
      };

      const originalIndex = state.planSegments.findIndex(
        (s) => s.id === targetSegment.id
      );
      const segmentsToInsert = [
        beforeSegment,
        insertionSegment,
        afterSegment,
      ].filter((s) => s.startDate <= s.endDate);
      state.planSegments.splice(originalIndex, 1, ...segmentsToInsert);

      // 2. 상태를 '삽입 모드'로 바꾸고, 새로 생긴 '삽입 구간'의 ID를 기억해둔다.
      state.isInsertionMode = true;
      state.insertionSegmentId = insertionSegment.id;

      // 3. UI를 '삽입 모드'용으로 바꾼다.
      $("#btnInsertMode").textContent = "✅ 교재 삽입 완료하기";
      $("#btnAddBook").textContent = "선택 기간에 삽입";
      $("#planEditor").scrollIntoView({ behavior: "smooth" });

      renderAllLanes();
      document.dispatchEvent(new Event("renderLanesComplete"));
      triggerPreview();
    } catch (e) {
      alert(`기간 삽입 준비 실패: ${e.message}`);
    }
  }
}

// ★ 신규: 삽입 모드를 깔끔하게 종료하는 함수
function exitInsertionMode() {
  state.isInsertionMode = false;
  state.insertionSegmentId = null;
  state.selectionStart = null;
  state.selectionEnd = null;
  lastSelectedDate = null;

  $("#btnAddBook").textContent = "레인에 추가";
  updateSelectionUI(); // 버튼과 선택 영역을 모두 초기화
}

// ★ 수정됨: addBookToLane 로직 단순화
async function addBookToLane() {
  if (state.isInsertionMode) {
    // 삽입 모드에서는, 기억해둔 '삽입 구간'에 책만 추가한다.
    if (state.insertionSegmentId) {
      await addBookToSegment(state.insertionSegmentId);
    } else {
      alert("오류: 삽입할 구간이 지정되지 않았습니다. 모드를 재시작해주세요.");
      exitInsertionMode();
    }
  } else {
    // 일반 모드에서는, 가장 첫 번째 구간에 책을 추가한다.
    const segment =
      state.planSegments.length > 0 ? state.planSegments[0] : null;
    if (segment) {
      await addBookToSegment(segment.id);
    } else {
      alert("교재를 추가할 플랜 구간이 없습니다. 새 플랜을 먼저 만들어주세요.");
    }
  }
}

// --- 나머지 헬퍼 함수들 (변경 없음) ---

async function addBookToSegment(segmentId) {
  const segment = state.planSegments.find((s) => s.id === segmentId);
  const materialId = $("#selMaterial").value;
  const lane = $("#selLane").value;
  if (!materialId || !lane || !segment) return;
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
    if (!Array.isArray(units) || !units.length)
      return alert("해당 교재의 차시 정보가 없습니다.");
    segment.lanes[lane].push({
      instanceId: `inst_${Date.now()}`,
      materialId,
      title,
      units,
      startUnitCode: units[0].unit_code,
      endUnitCode: units[units.length - 1].unit_code,
    });
    renderAllLanes();
    document.dispatchEvent(new Event("renderLanesComplete"));
    triggerPreview();
  } catch (e) {
    alert(`교재 추가 실패: ${e.message}`);
  }
}

function findTargetSegmentForInsertion() {
  const start = state.selectionStart;
  const end = state.selectionEnd;
  const targetSegment = state.planSegments.find(
    (s) => start >= s.startDate && start <= s.endDate
  );
  return { start, end, targetSegment };
}
async function getPlanItems(startDate, endDate, segment) {
  if (startDate > endDate) return [];
  const defaultSchedule =
    state.allClasses.find((c) => c.id === state.selectedStudent.class_id)
      ?.schedule_days || "MON,WED,FRI";
  const body = {
    startDate,
    endDate,
    days: (segment.days || defaultSchedule).toUpperCase(),
    lanes: segment.lanes,
    userSkips: Object.entries(state.userSkips).map(([date, v]) => ({
      date,
      ...v,
    })),
    events: state.allEvents,
    studentInfo: state.selectedStudent,
  };
  const res = await api("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.items || [];
}
function getPreviousDay(dateStr) {
  const date = new Date(dateStr);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function getNextDay(dateStr) {
  const date = new Date(dateStr);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
async function savePlan() {
  if (!state.selectedStudent) return alert("학생을 선택하세요.");
  const planToSave = {
    planId:
      state.editingPlanId || `pln_${Date.now()}_${state.selectedStudent.id}`,
    studentId: state.selectedStudent.id,
    planSegments: state.planSegments.map((seg) => ({
      id: seg.id,
      startDate: seg.startDate,
      endDate: seg.endDate,
      days: seg.days,
      lanes: {
        main1: seg.lanes.main1.map((b) => ({
          instanceId: b.instanceId,
          materialId: b.materialId,
          startUnitCode: b.startUnitCode,
          endUnitCode: b.endUnitCode,
        })),
        main2: seg.lanes.main2.map((b) => ({
          instanceId: b.instanceId,
          materialId: b.materialId,
          startUnitCode: b.startUnitCode,
          endUnitCode: b.endUnitCode,
        })),
        vocab: seg.lanes.vocab.map((b) => ({
          instanceId: b.instanceId,
          materialId: b.materialId,
          startUnitCode: b.startUnitCode,
          endUnitCode: b.endUnitCode,
        })),
      },
    })),
    userSkips: state.userSkips,
  };
  try {
    if (state.editingPlanId) {
      await api(`/api/plans?planId=${state.editingPlanId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(planToSave),
      });
      alert("플랜이 수정되었습니다.");
    } else {
      await api("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          students: [state.selectedStudent],
          ...planToSave,
        }),
      });
      alert("플랜이 저장되었습니다.");
    }
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
window.deletePlan = deletePlan;
async function loadPlanForEditing(planId) {
  const plan = state.studentPlans.find((p) => p.planId === planId);
  if (!plan) return alert("플랜 정보를 찾을 수 없습니다.");

  clearPlanEditor();
  state.editingPlanId = planId;
  let segmentsToLoad = [];
  if (plan.planSegments && plan.planSegments.length > 0) {
    segmentsToLoad = JSON.parse(JSON.stringify(plan.planSegments));
  } else if (plan.context) {
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
  for (const segment of segmentsToLoad) {
    for (const lane in segment.lanes) {
      for (const book of segment.lanes[lane]) {
        const materialInfo = state.allMaterials.find(
          (m) => m.material_id === book.materialId
        );
        if (materialInfo) book.title = materialInfo.title;
        const isVocab = lane === "vocab";
        const units = await api(
          isVocab
            ? `/api/vocaBook?materialId=${book.materialId}`
            : `/api/mainBook?materialId=${book.materialId}`
        );
        book.units = units;
        book.instanceId =
          book.instanceId || `inst_${Date.now()}_${Math.random()}`;
      }
    }
  }
  state.planSegments = segmentsToLoad;

  if (state.planSegments.length > 0) {
    $("#startDate").value = state.planSegments[0].startDate;
    $("#endDate").value =
      state.planSegments[state.planSegments.length - 1].endDate;
    // 요일은 첫 번째 구간의 설정을 대표로 표시합니다.
    $("#customDays").value = state.planSegments[0].days || "";
  }

  if (plan.context && Array.isArray(plan.context.userSkips)) {
    state.userSkips = plan.context.userSkips.reduce((acc, skip) => {
      acc[skip.date] = { type: skip.type, reason: skip.reason };
      return acc;
    }, {});
  } else {
    state.userSkips = plan.userSkips || {};
  }
  renderAllLanes();
  document.dispatchEvent(new Event("renderLanesComplete"));
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
