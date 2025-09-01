// lib/kv.js — 수정본
import { kv as vercelKv } from "@vercel/kv";

function kvEnabled() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export function isKvReady() {
  return kvEnabled();
}

// --- [신규] 이벤트 데이터 관리 함수 ---
const EVENTS_KEY = "edu:events";

export async function getEvents() {
  if (!kvEnabled()) return [];
  try {
    return (await vercelKv.get(EVENTS_KEY)) || [];
  } catch (e) {
    console.error("KV read error for events:", e);
    return [];
  }
}

export async function saveEvents(events) {
  if (!kvEnabled()) {
    throw new Error("저장 기능(KV 데이터베이스)이 설정되지 않았습니다.");
  }
  await vercelKv.set(EVENTS_KEY, events);
}
