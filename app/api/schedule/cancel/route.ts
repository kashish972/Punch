import { NextResponse } from "next/server";

import { qstashClient } from "@/lib/qstash";

type CancelBody = { messageId?: string };

export async function POST(request: Request) {
  let body: CancelBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const messageId = body.messageId?.trim();
  if (!messageId) {
    return NextResponse.json({ error: "messageId is required." }, { status: 400 });
  }

  try {
    await qstashClient().messages.cancel(messageId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = (err as Error).message;
    // Already delivered or already cancelled — the caller's intent is satisfied.
    if (/not found|404/i.test(message)) {
      return NextResponse.json({ ok: true, alreadyGone: true });
    }
    return NextResponse.json({ error: `Could not cancel: ${message}` }, { status: 502 });
  }
}
