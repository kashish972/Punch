export const KEKA_URL =
  "https://cloudanalogy.keka.com/k/dashboard/api/mytime/attendance/remoteclockin";

export type Action = "in" | "out";

export type PunchResult = {
  ok: boolean;
  /** HTTP status Keka replied with, or 0 if it was never reached. */
  status: number;
  timestamp: string;
  data: unknown;
  error?: string;
  /** True when retrying cannot help — a bad or expired token. */
  permanent: boolean;
};

export function normalizeToken(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/^Bearer\s+/i, "");
}

/** Milliseconds until the JWT's `exp`, or null when it carries no expiry. */
export function tokenExpiryMs(token: string): number | null {
  const parts = normalizeToken(token).split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export async function punch(token: string, action: Action, note = ""): Promise<PunchResult> {
  const timestamp = new Date().toISOString();
  const payload = {
    timestamp,
    attendanceLogSource: 1,
    locationAddress: null,
    manualClockinType: 3,
    note,
    originalPunchStatus: action === "in" ? 0 : 1,
  };

  let response: Response;
  try {
    response = await fetch(KEKA_URL, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9,en-IN;q=0.8",
        authorization: `Bearer ${normalizeToken(token)}`,
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
    return {
      ok: false,
      status: 0,
      timestamp,
      data: null,
      error: `Could not reach Keka: ${(err as Error).message}`,
      permanent: false,
    };
  }

  const raw = await response.text();
  let data: unknown = raw;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    /* keep the raw text */
  }

  if (!response.ok) {
    const unauthorized = response.status === 401 || response.status === 403;
    return {
      ok: false,
      status: response.status,
      timestamp,
      data,
      error: unauthorized
        ? "Token rejected (401). It has probably expired — grab a fresh one."
        : `Keka returned ${response.status}.`,
      permanent: unauthorized || (response.status >= 400 && response.status < 500),
    };
  }

  return { ok: true, status: response.status, timestamp, data, permanent: false };
}
