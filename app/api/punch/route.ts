import { NextResponse } from "next/server";

import { normalizeToken, punch } from "@/lib/keka";

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

  const token = normalizeToken(body.token);
  if (!token) {
    return NextResponse.json({ error: "Token is required." }, { status: 400 });
  }
  if (body.action !== "in" && body.action !== "out") {
    return NextResponse.json({ error: "action must be 'in' or 'out'." }, { status: 400 });
  }

  const result = await punch(token, body.action, body.note ?? "");

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, status: result.status, data: result.data },
      { status: result.status === 401 ? 401 : 502 },
    );
  }

  return NextResponse.json({ ok: true, timestamp: result.timestamp, data: result.data });
}
