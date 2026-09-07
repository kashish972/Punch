import { NextResponse } from "next/server";

import { qstashClient } from "@/lib/qstash";

/** Plain-English meaning for each QStash delivery state. */
const EXPLANATIONS: Record<string, string> = {
  CREATED: "Queued. QStash is holding it until the fire time.",
  ACTIVE: "Being delivered right now.",
  RETRY: "Delivery failed and QStash is retrying.",
  DELIVERED: "Delivered — your endpoint answered 2xx.",
  ERROR: "QStash could not deliver it. See the error below.",
  FAILED: "Delivery failed permanently after all retries.",
  CANCELED: "Cancelled before it fired.",
  IN_PROGRESS: "Delivery in progress.",
};

export async function GET(request: Request) {
  const messageId = new URL(request.url).searchParams.get("messageId")?.trim();
  if (!messageId) {
    return NextResponse.json({ error: "messageId is required." }, { status: 400 });
  }

  try {
    const { logs } = await qstashClient().logs({ messageIds: [messageId] });

    if (logs.length === 0) {
      return NextResponse.json({
        ok: true,
        found: false,
        summary: "QStash has no record of this message yet.",
      });
    }

    // Newest first, so the head is the current state.
    const sorted = [...logs].sort((a, b) => b.time - a.time);
    const latest = sorted[0];

    return NextResponse.json({
      ok: true,
      found: true,
      state: latest.state,
      summary: EXPLANATIONS[latest.state] ?? latest.state,
      url: latest.url,
      error: latest.error,
      history: sorted.map((log) => ({
        state: log.state,
        at: new Date(log.time).toISOString(),
        error: log.error,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read QStash logs: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
