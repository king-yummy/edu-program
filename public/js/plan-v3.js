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
  insertionSegmentId: null,
  currentEventMonth: new Date(),
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
    state.planSegments[0].startDate = $("#startDate").value;
    const lastSegment = state.planSegments[state.planSegments.length - 1];
    lastSegment.endDate = $("#endDate").value;
    const defaultSchedule =
      state.allClasses.find((c) => c.id === state.selectedStudent.class_id)
        ?.schedule_days || "MON,WED,FRI";
    const newDays = $("#customDays").value || defaultSchedule;
    for (const segment of state.planSegments) {
      segment.days = newDays;
    }
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
    renderScopedEventInputs();
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
  $("#btnPrint").onclick = prepareAndPrint;
  $("#btnInsertMode").onclick = toggleInsertionMode;
  $("#startDate").onchange = updatePlanSegmentDetails;
  $("#endDate").onchange = updatePlanSegmentDetails;
  $("#customDays").oninput = updatePlanSegmentDetails;
  $("#btnPrevMonth").onclick = () => {
    state.currentEventMonth.setMonth(state.currentEventMonth.getMonth() - 1);
    renderEvents();
  };
  $("#btnNextMonth").onclick = () => {
    state.currentEventMonth.setMonth(state.currentEventMonth.getMonth() + 1);
    renderEvents();
  };
  $("#eventScope").onchange = renderScopedEventInputs;
}

function renderEvents() {
  const year = state.currentEventMonth.getFullYear();
  const month = state.currentEventMonth.getMonth() + 1;
  $("#currentMonthDisplay").textContent = `${year}년 ${month}월`;
  const monthString = month < 10 ? `0${month}` : `${month}`;
  const filteredEvents = state.allEvents.filter((event) =>
    event.date.startsWith(`${year}-${monthString}`)
  );
  const listEl = $("#eventList");
  if (!filteredEvents.length) {
    listEl.innerHTML = `<div class="muted">해당 월에 등록된 이벤트가 없습니다.</div>`;
    return;
  }
  const scopeMap = { all: "전체", school: "학교", grade: "학년", class: "반" };
  listEl.innerHTML = filteredEvents
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(
      (event) => `
        <div class="list-item" style="display:flex; justify-content:space-between; align-items:center;">
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

  // ▼▼▼ [교체] scopeValue를 가져오는 부분을 아래 코드로 교체하세요. ▼▼▼
  let scopeValue = "";
  if (!isAll) {
    const inputs = $$(
      "#scopedValueContainer select, #scopedValueContainer input"
    );
    if (scope === "school_grade" && inputs.length === 2) {
      // 학교 및 학년별: "학교이름:학년" 형태로 값을 조합
      scopeValue = `${inputs[0].value}:${inputs[1].value}`;
    } else if (inputs.length > 0) {
      scopeValue = (inputs[0].value || "").trim();
    }
  }
  // ▲▲▲ [교체] 여기까지 ▲▲▲

  if (!date || !title) return alert("날짜와 내용을 입력하세요.");
  if (!isAll && !scopeValue)
    return alert("부분 설정 값을 선택하거나 입력하세요.");
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
    if (!isAll) {
      const input = $(
        "#scopedValueContainer select, #scopedValueContainer input"
      )[0];
      if (input) input.value = "";
    }
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

function renderScopedEventInputs() {
  const scope = $("#eventScope").value;
  const container = $("#scopedValueContainer");
  container.innerHTML = ""; // 컨테이너 초기화

  let options = [];

  const createSelect = (opts, placeholder) => {
    const el = document.createElement("select");
    el.style.flex = "1";
    el.innerHTML = `<option value="">${placeholder}</option>` + opts;
    return el;
  };

  if (scope === "school" || scope === "grade" || scope === "class") {
    let selectHTML = "";
    if (scope === "school") {
      options = [
        ...new Set(state.allStudents.map((s) => s.school).filter(Boolean)),
      ];
      selectHTML = options
        .map((o) => `<option value="${o}">${o}</option>`)
        .join("");
      container.appendChild(createSelect(selectHTML, "학교 선택"));
    } else if (scope === "grade") {
      options = [
        ...new Set(
          state.allStudents.map((s) => String(s.grade)).filter(Boolean)
        ),
      ].sort();
      selectHTML = options
        .map((o) => `<option value="${o}">${o}학년</option>`)
        .join("");
      container.appendChild(createSelect(selectHTML, "학년 선택"));
    } else if (scope === "class") {
      options = state.allClasses;
      selectHTML = options
        .map((o) => `<option value="${o.id}">${o.name}</option>`)
        .join("");
      container.appendChild(createSelect(selectHTML, "반 선택"));
    }
  } else if (scope === "school_grade") {
    // 1. 학교 선택 드롭다운 생성
    const schoolOptions = [
      ...new Set(state.allStudents.map((s) => s.school).filter(Boolean)),
    ];
    const schoolSelectHTML = schoolOptions
      .map((o) => `<option value="${o}">${o}</option>`)
      .join("");
    const schoolSelect = createSelect(schoolSelectHTML, "학교 먼저 선택");
    container.appendChild(schoolSelect);

    // 2. 학교 선택 시, 학년 드롭다운을 동적으로 생성
    schoolSelect.onchange = () => {
      // 기존 학년 드롭다운이 있다면 제거
      if (container.children.length > 1) {
        container.removeChild(container.lastChild);
      }
      const selectedSchool = schoolSelect.value;
      if (!selectedSchool) return;

      const gradeOptions = [
        ...new Set(
          state.allStudents
            .filter((s) => s.school === selectedSchool)
            .map((s) => String(s.grade))
            .filter(Boolean)
        ),
      ].sort();

      const gradeSelectHTML = gradeOptions
        .map((o) => `<option value="${o}">${o}학년</option>`)
        .join("");
      const gradeSelect = createSelect(gradeSelectHTML, "학년 선택");
      container.appendChild(gradeSelect);
    };
  }
}

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
  const today = new Date().toISOString().slice(0, 10);
  $("#startDate").value = today;
  $("#endDate").value = today;
  const defaultSchedule = state.selectedStudent
    ? state.allClasses.find((c) => c.id === state.selectedStudent.class_id)
        ?.schedule_days || "MON,WED,FRI"
    : "MON,WED,FRI";
  $("#customDays").value = defaultSchedule;
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
  renderAllLanes();
  document.dispatchEvent(new Event("renderLanesComplete"));
  $("#result").innerHTML = "교재를 추가하고 기간을 설정하세요.";
  $("#planActions").style.display = "none";
  $("#planEditor").style.display = "block";
  $("#btnSave").textContent = "새 플랜 저장하기";
  triggerPreview();
}

function clearPlanEditor() {
  state.planSegments = [];
  state.userSkips = {};
  renderAllLanes();
}

function renderAllLanes() {
  const laneContents = {
    main1: "<h5>메인 1</h5>",
    main2: "<h5>메인 2</h5>",
    vocab: "<h5>어휘</h5>",
  };
  const consolidatedBooks = {};
  for (const segment of state.planSegments) {
    for (const lane in segment.lanes) {
      for (const book of segment.lanes[lane]) {
        if (!consolidatedBooks[book.instanceId]) {
          consolidatedBooks[book.instanceId] = {
            ...JSON.parse(JSON.stringify(book)),
            lane: lane,
            segments: [],
          };
        }
        consolidatedBooks[book.instanceId].segments.push({
          id: segment.id,
          startDate: segment.startDate,
          endDate: segment.endDate,
          startUnitCode: book.startUnitCode,
          endUnitCode: book.endUnitCode,
        });
      }
    }
  }
  for (const instanceId in consolidatedBooks) {
    const bookGroup = consolidatedBooks[instanceId];
    const firstSegment = bookGroup.segments[0];
    const lastSegment = bookGroup.segments[bookGroup.segments.length - 1];
    const dateRanges = bookGroup.segments
      .map((s) => `${s.startDate.slice(5)} ~ ${s.endDate.slice(5)}`)
      .join(", ");
    const startOptions = (bookGroup.units || [])
      .map(
        (u) =>
          `<option value="${u.unit_code}" ${
            u.unit_code === firstSegment.startUnitCode ? "selected" : ""
          }>${u.lecture_range || u.lecture || ""} — ${u.title || ""}</option>`
      )
      .join("");
    const endOptions = (bookGroup.units || [])
      .map(
        (u) =>
          `<option value="${u.unit_code}" ${
            u.unit_code === lastSegment.endUnitCode ? "selected" : ""
          }>${u.lecture_range || u.lecture || ""} — ${u.title || ""}</option>`
      )
      .join("");
    const cardHTML = `
      <div class="book-card">
          <div class="muted small" style="padding: 4px; background: #f8fafc;">${dateRanges}</div>
          <b>${bookGroup.title}</b>
          <div class="row mt">
            <div style="flex:1">
              <label class="small">시작 차시</label>
              <select data-type="start" data-instance-id="${instanceId}">${startOptions}</select>
            </div>
            <div style="flex:1">
              <label class="small">종료 차시</label>
              <select data-type="end" data-instance-id="${instanceId}">${endOptions}</select>
            </div>
          </div>
          <button class="btn-xs" style="background:#ef4444; width:auto; margin-top:8px;" onclick="removeFromLane('${instanceId}')">삭제</button>
      </div>`;
    laneContents[bookGroup.lane] += cardHTML;
  }
  $("#laneMain1").innerHTML = laneContents.main1;
  $("#laneMain2").innerHTML = laneContents.main2;
  $("#laneVocab").innerHTML = laneContents.vocab;
}

document.addEventListener("renderLanesComplete", () => {
  $$("#laneMain1 select, #laneMain2 select, #laneVocab select").forEach(
    (s) => (s.onchange = onUnitChange)
  );
});

function onUnitChange(e) {
  const { type, instanceId } = e.target.dataset;
  const newValue = e.target.value;
  let targetSegment;
  if (type === "start") {
    targetSegment = state.planSegments.find(
      (s) =>
        s.lanes.main1?.some((b) => b.instanceId === instanceId) ||
        s.lanes.main2?.some((b) => b.instanceId === instanceId) ||
        s.lanes.vocab?.some((b) => b.instanceId === instanceId)
    );
  } else {
    targetSegment = [...state.planSegments]
      .reverse()
      .find(
        (s) =>
          s.lanes.main1?.some((b) => b.instanceId === instanceId) ||
          s.lanes.main2?.some((b) => b.instanceId === instanceId) ||
          s.lanes.vocab?.some((b) => b.instanceId === instanceId)
      );
  }
  if (targetSegment) {
    for (const lane in targetSegment.lanes) {
      const book = targetSegment.lanes[lane].find(
        (b) => b.instanceId === instanceId
      );
      if (book) {
        if (type === "start") book.startUnitCode = newValue;
        else book.endUnitCode = newValue;
        break;
      }
    }
  }
  triggerPreview();
}

window.removeFromLane = (instanceId) => {
  for (const segment of state.planSegments) {
    for (const lane in segment.lanes) {
      segment.lanes[lane] = segment.lanes[lane].filter(
        (b) => b.instanceId !== instanceId
      );
    }
  }
  state.planSegments = state.planSegments.filter((s) =>
    Object.values(s.lanes).some((lane) => lane.length > 0)
  );
  mergeAdjacentSegments();
  renderAllLanes();
  document.dispatchEvent(new Event("renderLanesComplete"));
  triggerPreview();
};

function mergeAdjacentSegments() {
  if (state.planSegments.length < 2) return;
  const merged = [];
  let current = JSON.parse(JSON.stringify(state.planSegments[0]));
  for (let i = 1; i < state.planSegments.length; i++) {
    const next = state.planSegments[i];
    const currentBooks = Object.values(current.lanes)
      .flat()
      .map((b) => b.instanceId)
      .sort()
      .join(",");
    const nextBooks = Object.values(next.lanes)
      .flat()
      .map((b) => b.instanceId)
      .sort()
      .join(",");
    if (
      currentBooks === nextBooks &&
      getNextDay(current.endDate) === next.startDate
    ) {
      current.endDate = next.endDate;
    } else {
      merged.push(current);
      current = JSON.parse(JSON.stringify(next));
    }
  }
  merged.push(current);
  state.planSegments = merged;
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

window.handleDateClick = (event, date) => {
  if (state.isInsertionMode) return;
  if (event.ctrlKey || event.metaKey) {
    const isNewSelection =
      !state.selectionStart ||
      (state.selectionStart &&
        state.selectionEnd &&
        state.selectionStart !== state.selectionEnd);
    if (isNewSelection) {
      state.selectionStart = date;
      state.selectionEnd = date;
    } else {
      const firstClickDate = state.selectionStart;
      if (date < firstClickDate) {
        state.selectionStart = date;
        state.selectionEnd = firstClickDate;
      } else {
        state.selectionEnd = date;
      }
    }
    updateSelectionUI();
  } else {
    openSkipModal(date);
  }
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

async function toggleInsertionMode() {
  if (state.isInsertionMode) {
    alert("교재 삽입을 완료했습니다.");
    exitInsertionMode();
  } else {
    if (!state.selectionStart) {
      return alert("먼저 미리보기에서 기간을 선택해주세요.");
    }
    const { start, end, targetSegment } = findTargetSegmentForInsertion();
    if (!targetSegment) {
      alert("교재를 삽입할 플랜 구간을 찾을 수 없습니다.");
      return;
    }
    try {
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
        lanes: { main1: [], main2: [], vocab: [] },
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
      state.isInsertionMode = true;
      state.insertionSegmentId = insertionSegment.id;
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

function exitInsertionMode() {
  state.isInsertionMode = false;
  state.insertionSegmentId = null;
  state.selectionStart = null;
  state.selectionEnd = null;
  $("#btnAddBook").textContent = "레인에 추가";
  updateSelectionUI();
}

async function addBookToLane() {
  if (state.isInsertionMode) {
    if (state.insertionSegmentId) {
      await addBookToSegment(state.insertionSegmentId);
    } else {
      alert("오류: 삽입할 구간이 지정되지 않았습니다. 모드를 재시작해주세요.");
      exitInsertionMode();
    }
  } else {
    const segment =
      state.planSegments.length > 0 ? state.planSegments[0] : null;
    if (segment) {
      await addBookToSegment(segment.id);
    } else {
      alert("교재를 추가할 플랜 구간이 없습니다. 새 플랜을 먼저 만들어주세요.");
    }
  }
}

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
  const instructionText = `
    <div class="muted small print-hide" style="margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 8px;">
      <b>💡 사용법:</b> 날짜를 그냥 클릭하면 <b>결석 처리</b>, <code>Ctrl</code> 또는 <code>Cmd</code>를 누른 채로 클릭하면 <b>기간 선택(교재 삽입용)</b>이 됩니다.
    </div>
  `;
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
      <thead style="font-size: 12px;">
        <tr><th rowspan="3" class="section-divider" style="width:100px; vertical-align: middle;">날짜</th><th colspan="5">메인 1</th> <th colspan="5" class="section-divider">메인 2</th> <th colspan="2">단어 DT</th></tr>
        <tr><th colspan="3">수업 진도</th> <th colspan="2">티칭 챌린지</th><th colspan="3">수업 진도</th> <th colspan="2" class="section-divider">티칭 챌린지</th><th rowspan="2" style="vertical-align: middle;">회차</th> <th rowspan="2" style="vertical-align: middle;">DT</th></tr>
        <tr><th>인강</th><th>교재 page</th><th>WB</th><th>개념+단어</th><th>문장학습</th><th>인강</th><th>교재 page</th><th>WB</th><th>개념+단어</th><th class="section-divider">문장학습</th></tr>
      </thead>`;
  let prevM1Id = null;
  let prevM2Id = null;
  const rows = dates
    .map((d) => {
      const dayItems = items.filter((x) => x.date === d);
      const skip = dayItems.find((x) => x.source === "skip");
      const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"];
      const dateObj = new Date(d + "T00:00:00Z");
      const dayName = DOW_KR[dateObj.getUTCDay()];
      const dateString = `${d.slice(2).replace(/-/g, ".")} (${dayName})`;
      const tag = `data-date="${d}" onclick="handleDateClick(event, '${d}')" style="cursor:pointer;"`;
      const m1 = dayItems.find(
        (x) => x.source === "main" && x.lane === "main1"
      );
      const m2 = dayItems.find(
        (x) => x.source === "main" && x.lane === "main2"
      );
      const v = dayItems.find((x) => x.source === "vocab");
      let rowClass = "";
      const m1Id = m1?.material_id || null;
      const m2Id = m2?.material_id || null;
      if ((prevM1Id && m1Id !== prevM1Id) || (prevM2Id && m2Id !== prevM2Id)) {
        if (prevM1Id || prevM2Id) {
          rowClass = "book-change-divider";
        }
      }
      prevM1Id = m1Id;
      prevM2Id = m2Id;
      if (skip) {
        return `<tr class="${rowClass}" ${tag}><td class="date-column section-divider">${dateString}</td><td colspan="12" style="color:#64748b;background:#f8fafc;">${skip.reason}</td></tr>`;
      }
      const renderMainLane = (mainItem) => {
        if (!mainItem) return `<td></td>`.repeat(5);
        const title =
          state.allMaterials.find((m) => m.material_id === mainItem.material_id)
            ?.title || mainItem.material_id;
        if (mainItem.isOT)
          return `<td colspan="5" style="background: #F9FF00; font-weight: bold;">"${title}" OT</td>`;
        if (mainItem.isReturn)
          return `<td colspan="5" style="background: #e0f2fe; font-weight: bold;">"${title}" 복귀</td>`;
        return `<td>${mainItem.lecture_range || ""}</td><td>${
          mainItem.pages ? `p.${mainItem.pages}` : ""
        }</td><td>${mainItem.wb ? `p.${mainItem.wb}` : ""}</td><td>${
          mainItem.dt_vocab || ""
        }</td><td>${mainItem.key_sents || ""}</td>`;
      };

      const m1Html = renderMainLane(m1).replace(
        /(<\/td>\s*){5}$/,
        "</td>".repeat(4) + '<td class="section-divider">'
      );
      const m2Html = renderMainLane(m2).replace(
        /(<\/td>\s*){5}$/,
        "</td>".repeat(4) + '<td class="section-divider">'
      );

      return `<tr class="${rowClass}" ${tag}>
                <td class="date-column section-divider">${dateString}</td>
                ${m1Html}
                ${m2Html}
                <td>${v?.lecture_range || ""}</td>
                <td>${v?.vocab_range || ""}</td>
              </tr>`;
    })
    .join("");
  $(
    "#result"
  ).innerHTML = `${studentHeader}${instructionText}${materialsHeaderHtml}<table class="table">${thead}<tbody>${rows}</tbody></table>`;
  updateSelectionUI();
}

function prepareAndPrint() {
  // 1. 이전에 추가했을 수 있는 페이지 나누기 클래스를 모두 제거합니다.
  $$(".page-break-after").forEach((el) =>
    el.classList.remove("page-break-after")
  );

  // 2. 미리보기 테이블에 있는 모든 날짜 행을 가져옵니다.
  const rows = $$("#result .table tbody tr[data-date]");
  const ROWS_PER_PAGE = 48; // 페이지당 행 개수 (조정 가능)

  // 3. 50번째 행마다 페이지 나누기 클래스를 추가합니다.
  rows.forEach((row, index) => {
    // index는 0부터 시작하므로 +1, 마지막 행에는 추가하지 않음
    if ((index + 1) % ROWS_PER_PAGE === 0 && index < rows.length - 1) {
      row.classList.add("page-break-after");
    }
  });

  // 4. 인쇄 대화상자를 엽니다.
  window.print();
}
