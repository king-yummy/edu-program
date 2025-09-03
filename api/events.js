// /api/events.js — 수정 후

// [수정] lib/kv.js에서 중앙 관리 함수를 가져옵니다.
import { getEvents, saveEvents, isKvReady } from "../lib/kv.js";

export default async function handler(req, res) {
  if (!isKvReady()) {
    return res
      .status(501)
      .json({ ok: false, error: "KV 데이터베이스가 설정되지 않았습니다." });
  }

  // --- GET: 모든 이벤트 조회 ---
  if (req.method === "GET") {
    try {
      const events = await getEvents();
      return res.status(200).json({ ok: true, events });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- POST: 새 이벤트 생성 ---
  if (req.method === "POST") {
    try {
      const body = req.body;
      const {
        date,
        title,
        scope,
        scopeValue,
        type = "event",
        applyTo = "attending",
      } = body;

      if (!date || !title || !scope || !type) {
        return res
          .status(400)
          .json({ ok: false, error: "date, title, scope, type이 필요합니다." });
      }

      const allEvents = await getEvents();
      const newEvent = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        date,
        title,
        scope,
        scopeValue: scopeValue || "",
        type,
        applyTo: type === "supplementary" ? "all" : applyTo,
      };

      allEvents.push(newEvent);
      await saveEvents(allEvents);
      return res.status(201).json({ ok: true, event: newEvent });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // --- DELETE: 이벤트 삭제 ---
  if (req.method === "DELETE") {
    try {
      const { eventId } = req.query;
      if (!eventId) {
        return res
          .status(400)
          .json({ ok: false, error: "eventId가 필요합니다." });
      }

      let allEvents = await getEvents();
      const initialLength = allEvents.length;
      allEvents = allEvents.filter((e) => e.id !== eventId);

      if (allEvents.length === initialLength) {
        return res.status(404).json({ ok: false, error: "Event not found." });
      }

      await saveEvents(allEvents);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res
    .status(405)
    .json({ ok: false, error: `Method ${req.method} Not Allowed` });
}
