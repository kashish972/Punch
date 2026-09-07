import { NextResponse } from "next/server";

import { seal } from "@/lib/crypto";
import { normalizeToken, tokenExpiryMs } from "@/lib/keka";
import { bypassHeaders, callbackUrl, qstashClient } from "@/lib/qstash";

/** Guard rails: at least a minute out, at most a working day and a half. */
const MIN_MINUTES = 1;
const MAX_MINUTES = 16 * 60;
/** Fire far enough before the token dies that a retry or two still lands. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

type ScheduleBody = {
  token?: string;
  minutes?: number;
  note?: string;
};

export async function POST(request: Request) {
  let body: ScheduleBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const token = normalizeToken(body.token);
  if (!token) {
    return NextResponse.json({ error: "Token is required." }, { status: 400 });
  }

  const minutes = Number(body.minutes);
  if (!Number.isFinite(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    return NextResponse.json(
      { error: `Duration must be between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.` },
      { status: 400 },
    );
  }

  const fireAt = Date.now() + minutes * 60_000;

  // A token that dies before the timer fires would make the clock-out a
  // guaranteed 401, so refuse loudly now rather than fail silently later.
  const expiresAt = tokenExpiryMs(token);
  if (expiresAt !== null && fireAt + EXPIRY_MARGIN_MS > expiresAt) {
    const hoursLeft = Math.max(0, (expiresAt - Date.now()) / 3_600_000);
    return NextResponse.json(
      {
        error:
          `This token expires in ${hoursLeft.toFixed(1)}h, before the auto clock-out would fire. ` +
          `Paste a fresher token or pick a shorter duration.`,
        tokenExpiresAt: new Date(expiresAt).toISOString(),
      },
      { status: 400 },
    );
  }

  let url: string;
  try {
    url = callbackUrl("/api/auto-clockout", request);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  try {
    const published = await qstashClient().publishJSON({
      url,
      body: { token: seal(token), note: body.note ?? "", scheduledFor: fireAt },
      notBefore: Math.floor(fireAt / 1000),
      retries: 3,
      headers: bypassHeaders(),
    });

    return NextResponse.json({
      ok: true,
      messageId: published.messageId,
      fireAt: new Date(fireAt).toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not schedule auto clock-out: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
