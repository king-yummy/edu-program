// api/_diag.js
import { google } from "googleapis";

export default async function handler(req, res) {
  const env = {
    GOOGLE_PROJECT_ID: !!process.env.GOOGLE_PROJECT_ID,
    GOOGLE_CLIENT_EMAIL: !!process.env.GOOGLE_CLIENT_EMAIL,
    GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
    SHEET_ID: !!process.env.SHEET_ID,
    CLASSES_RANGE: process.env.CLASSES_RANGE || "class!A:Z",
    STUDENTS_RANGE: process.env.STUDENTS_RANGE || "student!A:Z",
    MATERIALS_RANGE: process.env.MATERIALS_RANGE || "material!A:Z",
  };
  const out = { ok: false, env, checks: {}, errors: {} };

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(
          /\\n/g,
          "\n"
        ),
      },
      projectId: process.env.GOOGLE_PROJECT_ID,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });
    const id = process.env.SHEET_ID;

    const ping = async (range) => {
      try {
        const r = await sheets.spreadsheets.values.get({
          spreadsheetId: id,
          range,
        });
        const values = r.data.values || [];
        return {
          ok: true,
          rows: values.length,
          header: values[0] || [],
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    };

    out.checks.class = await ping(env.CLASSES_RANGE);
    out.checks.student = await ping(env.STUDENTS_RANGE);
    out.checks.material = await ping(env.MATERIALS_RANGE);
    out.ok =
      out.checks.class.ok || out.checks.student.ok || out.checks.material.ok
        ? true
        : false;

    return res.status(200).json(out);
  } catch (e) {
    out.errors.auth = e.message;
    return res.status(200).json(out);
  }
}
