// /lib/schedule.js 파일의 buildQueueFactory 함수 수정

function buildQueueFactory(mainBook, vocaBook) {
  return function buildQueue(list, isVocab = false) {
    const getAll = (materialId) =>
      (isVocab ? vocaBook : mainBook)
        .filter((u) => String(u.material_id) === String(materialId))
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

    const out = [];
    (list || []).forEach((book, index) => {
      const all = getAll(book.materialId);
      if (!all.length) return;

      let startIdx = 0;
      if (book.startUnitCode) {
        const j = all.findIndex(
          (u) => String(u.unit_code) === String(book.startUnitCode)
        );
        startIdx = j >= 0 ? j : 0;
      }

      let endIdx = all.length;
      if (book.endUnitCode) {
        const j = all.findIndex(
          (u) => String(u.unit_code) === String(book.endUnitCode)
        );
        endIdx = j >= 0 ? j + 1 : all.length;
      }

      if (startIdx >= endIdx) return;

      const slicedUnits = all
        .slice(startIdx, endIdx)
        .map((unit) => ({ ...unit, instanceId: book.instanceId }));
      if (!slicedUnits.length) return;

      const firstUnitInSelection = slicedUnits[0];
      const isActuallyFirstUnitOfBook =
        String(all[0].unit_code).trim() ===
        String(firstUnitInSelection.unit_code).trim();

      // ▼▼▼ '복귀'와 'OT' 로직을 모두 제거하여 단순화 ▼▼▼
      if (!isVocab) {
        if (index > 0 && isActuallyFirstUnitOfBook) {
          // 다음 교재로 넘어갈 때 첫 유닛이면 OT로 표시
          firstUnitInSelection.isOT = true;
        } else if (index === 0 && isActuallyFirstUnitOfBook) {
          // 첫번째 교재의 첫 유닛이면 OT로 표시
          firstUnitInSelection.isOT = true;
        }
      }
      // ▲▲▲ '복귀' 로직이 완전히 삭제되었습니다 ▲▲▲

      out.push(...slicedUnits);
    });
    return out;
  };
}
