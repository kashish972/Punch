import { NextResponse } from "next/server";

import { open } from "@/lib/crypto";
import { punch } from "@/lib/keka";
import { callbackUrl, qstashReceiver } from "@/lib/qstash";

type CallbackBody = {
  token?: string;
  note?: string;
  scheduledFor?: number;
};

export async function POST(request: Request) {
  const signature = request.headers.get("upstash-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 401 });
  }

  const raw = await request.text();

  // Anyone can POST here, so the signature is the only thing standing between
  // the internet and a clock-out on someone's timesheet.
  try {
    await qstashReceiver().verify({
      signature,
      body: raw,
      url: callbackUrl("/api/auto-clockout", request),
    });
  } catch (err) {
    console.error("[auto-clockout] signature rejected:", (err as Error).message);
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let body: CallbackBody;
  try {
    body = JSON.parse(raw) as CallbackBody;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (!body.token) {
    return NextResponse.json({ error: "Payload carried no token." }, { status: 400 });
  }

  let token: string;
  try {
    token = open(body.token);
  } catch (err) {
    // A key rotation orphans in-flight messages; retrying will not fix that.
    console.error("[auto-clockout] could not decrypt token:", (err as Error).message);
    return NextResponse.json({ error: "Could not decrypt token." }, { status: 200 });
  }

  const result = await punch(token, "out", body.note ?? "");

  if (!result.ok) {
    console.error("[auto-clockout] punch failed:", result.status, result.error);
    // 2xx tells QStash to stop; only a transient failure is worth retrying.
    return NextResponse.json(
      { ok: false, error: result.error, status: result.status },
      { status: result.permanent ? 200 : 500 },
    );
  }

  console.log("[auto-clockout] clocked out at", result.timestamp);
  return NextResponse.json({ ok: true, timestamp: result.timestamp });
}
