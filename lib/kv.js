// lib/kv.js
import { kv as vercelKv } from "@vercel/kv";

function kvEnabled() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

const KEY = "edu:tests";

export async function getAllTests() {
  if (!kvEnabled()) return [];
  try {
    return (await vercelKv.get(KEY)) || [];
  } catch {
    return [];
  }
}

export async function putAllTests(list) {
  if (!kvEnabled()) throw new Error("KV not configured");
  await vercelKv.set(KEY, list);
}

export function isKvReady() {
  return kvEnabled();
}
