// lib/sheets.js
import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },
  projectId: process.env.GOOGLE_PROJECT_ID,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

async function getSheets() {
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

export async function readSheetObjects(range) {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) return [];
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });
  const values = res.data.values || [];
  if (!values.length) return [];
  const header = values[0].map((h) => String(h).trim());
  const rows = values.slice(1);
  const toObj = (row) =>
    Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""]));
  return rows.filter((r) => r.some((c) => c != null && c !== "")).map(toObj);
}
