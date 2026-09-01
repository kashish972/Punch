import { NextResponse } from "next/server";

const KEKA_URL =
  "https://cloudanalogy.keka.com/k/dashboard/api/mytime/attendance/remoteclockin";

type PunchBody = {
  token?: string;
  action?: "in" | "out";
  note?: string;
};

export async function POST(request: Request) {
  let body: PunchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const token = body.token?.trim().replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "Token is required." }, { status: 400 });
  }
  if (body.action !== "in" && body.action !== "out") {
    return NextResponse.json({ error: "action must be 'in' or 'out'." }, { status: 400 });
  }

  const timestamp = new Date().toISOString();
  const payload = {
    timestamp,
    attendanceLogSource: 1,
    locationAddress: null,
    manualClockinType: 3,
    note: body.note ?? "",
    originalPunchStatus: body.action === "in" ? 0 : 1,
  };

  let kekaResponse: Response;
  try {
    kekaResponse = await fetch(KEKA_URL, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9,en-IN;q=0.8",
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
        origin: "https://cloudanalogy.keka.com",
        referer: "https://cloudanalogy.keka.com/",
        "x-requested-with": "XMLHttpRequest",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not reach Keka: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const raw = await kekaResponse.text();
  let data: unknown = raw;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    /* keep the raw text */
  }

  if (!kekaResponse.ok) {
    const message =
      kekaResponse.status === 401
        ? "Token rejected (401). It has probably expired — grab a fresh one."
        : `Keka returned ${kekaResponse.status}.`;
    return NextResponse.json(
      { error: message, status: kekaResponse.status, data },
      { status: kekaResponse.status === 401 ? 401 : 502 },
    );
  }

  return NextResponse.json({ ok: true, timestamp, data });
}
