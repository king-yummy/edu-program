// /web/js/plan.js
const $ = (q) => document.querySelector(q);
const api = (p, opt) => fetch(p, opt).then((r) => r.json());

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

  const students = await api(
    `/api/student?classId=${encodeURIComponent(classId)}`
  );
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
