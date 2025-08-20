// server/sheets.js (CommonJS)
const { google } = require("googleapis");

// Google Auth (환경변수는 .env에서 로드됨)
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

// A1 표를 헤더 기반 객체배열로 변환
async function readSheetObjects(sheetName, range = "A1:ZZZ") {
  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${range}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const values = res.data.values || [];
  if (values.length === 0) return [];
  const header = values[0].map((h) => String(h).trim());
  const rows = values.slice(1);

  const toObj = (row) =>
    Object.fromEntries(header.map((h, i) => [h, row[i] != null ? row[i] : ""]));

  // 완전 공백 행 제거
  return rows.filter((r) => r.some((c) => c !== "" && c != null)).map(toObj);
}

module.exports = { readSheetObjects };
