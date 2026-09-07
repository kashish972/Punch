"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Action = "in" | "out";

type LogEntry = {
  action: Action;
  at: string;
  ok: boolean;
  message: string;
};

type TokenInfo = {
  username?: string;
  email?: string;
  expiresAt?: Date;
};

type Schedule = {
  messageId: string;
  fireAt: string;
};

const TOKEN_KEY = "keka.token";
const LOG_KEY = "keka.log";
const SCHEDULE_KEY = "keka.schedule";

const DURATIONS = [
  { label: "4h", minutes: 240 },
  { label: "5h", minutes: 300 },
  { label: "8h", minutes: 480 },
  { label: "9h", minutes: 540 },
];

function decodeToken(token: string): TokenInfo | null {
  const parts = token.trim().replace(/^Bearer\s+/i, "").split(".");
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as Record<string, unknown>;
    return {
      username: typeof claims.username === "string" ? claims.username : undefined,
      email: typeof claims.email === "string" ? claims.email : undefined,
      expiresAt: typeof claims.exp === "number" ? new Date(claims.exp * 1000) : undefined,
    };
  } catch {
    return null;
  }
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function Home() {
  const [token, setToken] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [now, setNow] = useState<Date | null>(null);

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoMinutes, setAutoMinutes] = useState(300);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY) ?? "");
    try {
      setLog(JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]") as LogEntry[]);
    } catch {
      setLog([]);
    }
    try {
      const saved = localStorage.getItem(SCHEDULE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Schedule;
        // A schedule whose time has passed already fired server-side.
        if (new Date(parsed.fireAt).getTime() > Date.now()) setSchedule(parsed);
        else localStorage.removeItem(SCHEDULE_KEY);
      }
    } catch {
      localStorage.removeItem(SCHEDULE_KEY);
    }
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const info = useMemo(() => (token.trim() ? decodeToken(token) : null), [token]);
  const expired = info?.expiresAt ? info.expiresAt.getTime() < Date.now() : false;

  const remaining = useMemo(() => {
    if (!schedule || !now) return null;
    return new Date(schedule.fireAt).getTime() - now.getTime();
  }, [schedule, now]);

  // The countdown hitting zero only means the timer elapsed here. Whether the
  // punch actually happened is something only QStash can tell us, so ask it.
  useEffect(() => {
    if (remaining === null || remaining > 0 || !schedule) return;
    const messageId = schedule.messageId;
    setSchedule(null);
    localStorage.removeItem(SCHEDULE_KEY);
    setStatus({ ok: true, message: "Timer elapsed — checking whether it was delivered…" });

    void (async () => {
      try {
        const res = await fetch(`/api/schedule/status?messageId=${encodeURIComponent(messageId)}`);
        const data = (await res.json()) as {
          error?: string;
          state?: string;
          summary?: string;
          error_?: string;
        } & { error?: string };
        if (!res.ok) {
          setStatus({ ok: false, message: data.error ?? "Could not check delivery status." });
          return;
        }
        const delivered = data.state === "DELIVERED";
        setStatus({
          ok: delivered,
          message: `${data.state ?? "UNKNOWN"} — ${data.summary ?? ""} Confirm in Keka.`,
        });
      } catch (err) {
        setStatus({ ok: false, message: (err as Error).message });
      }
    })();
  }, [remaining, schedule]);

  const saveToken = useCallback((value: string) => {
    setToken(value);
    localStorage.setItem(TOKEN_KEY, value);
  }, []);

  const saveSchedule = useCallback((next: Schedule | null) => {
    setSchedule(next);
    if (next) localStorage.setItem(SCHEDULE_KEY, JSON.stringify(next));
    else localStorage.removeItem(SCHEDULE_KEY);
  }, []);

  const appendLog = useCallback((entry: LogEntry) => {
    setLog((prev) => {
      const next = [entry, ...prev].slice(0, 20);
      localStorage.setItem(LOG_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const cancelSchedule = useCallback(
    async (silent = false) => {
      if (!schedule) return;
      setCancelling(true);
      try {
        const res = await fetch("/api/schedule/cancel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageId: schedule.messageId }),
        });
        const data = (await res.json()) as { error?: string };
        if (res.ok) {
          saveSchedule(null);
          if (!silent) setStatus({ ok: true, message: "Auto clock-out cancelled." });
        } else if (!silent) {
          setStatus({ ok: false, message: data.error ?? "Could not cancel auto clock-out." });
        }
      } catch (err) {
        if (!silent) setStatus({ ok: false, message: (err as Error).message });
      } finally {
        setCancelling(false);
      }
    },
    [saveSchedule, schedule],
  );

  /** For when you already clocked in elsewhere (Keka's own site, the app). */
  const scheduleOnly = useCallback(async () => {
    if (!token.trim()) {
      setStatus({ ok: false, message: "Paste your Keka bearer token first." });
      return;
    }
    setScheduling(true);
    setStatus(null);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, minutes: autoMinutes, note }),
      });
      const data = (await res.json()) as { error?: string; messageId?: string; fireAt?: string };
      if (res.ok && data.messageId && data.fireAt) {
        saveSchedule({ messageId: data.messageId, fireAt: data.fireAt });
        setStatus({
          ok: true,
          message: `Auto clock-out scheduled for ${formatTime(new Date(data.fireAt))}`,
        });
      } else {
        setStatus({ ok: false, message: data.error ?? "Could not schedule auto clock-out." });
      }
    } catch (err) {
      setStatus({ ok: false, message: (err as Error).message });
    } finally {
      setScheduling(false);
    }
  }, [autoMinutes, note, saveSchedule, token]);

  const checkStatus = useCallback(async () => {
    if (!schedule) return;
    try {
      const res = await fetch(
        `/api/schedule/status?messageId=${encodeURIComponent(schedule.messageId)}`,
      );
      const data = (await res.json()) as {
        error?: string;
        state?: string;
        summary?: string;
        url?: string;
      };
      setStatus(
        res.ok
          ? {
              ok: data.state !== "ERROR" && data.state !== "FAILED",
              message: `${data.state ?? "UNKNOWN"} — ${data.summary ?? ""}${
                data.url ? ` (callback: ${data.url})` : ""
              }`,
            }
          : { ok: false, message: data.error ?? "Could not check status." },
      );
    } catch (err) {
      setStatus({ ok: false, message: (err as Error).message });
    }
  }, [schedule]);

  const punch = useCallback(
    async (action: Action) => {
      if (!token.trim()) {
        setStatus({ ok: false, message: "Paste your Keka bearer token first." });
        return;
      }
      setPending(action);
      setStatus(null);
      try {
        const res = await fetch("/api/punch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, action, note }),
        });
        const data = (await res.json()) as { error?: string; timestamp?: string };
        const ok = res.ok;
        let message = ok
          ? `Clocked ${action} at ${formatTime(new Date(data.timestamp ?? Date.now()))}`
          : data.error ?? `Request failed (${res.status}).`;

        if (ok && action === "in" && autoEnabled) {
          const scheduled = await fetch("/api/schedule", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token, minutes: autoMinutes, note }),
          });
          const sData = (await scheduled.json()) as {
            error?: string;
            messageId?: string;
            fireAt?: string;
          };
          if (scheduled.ok && sData.messageId && sData.fireAt) {
            saveSchedule({ messageId: sData.messageId, fireAt: sData.fireAt });
            message += ` · auto clock-out at ${formatTime(new Date(sData.fireAt))}`;
          } else {
            message += ` · but auto clock-out was NOT scheduled: ${sData.error ?? "unknown error"}`;
          }
        }

        // A manual clock-out makes any pending timer wrong, so retire it.
        if (ok && action === "out" && schedule) {
          await cancelSchedule(true);
        }

        setStatus({ ok, message });
        appendLog({ action, at: new Date().toISOString(), ok, message });
      } catch (err) {
        setStatus({ ok: false, message: (err as Error).message });
      } finally {
        setPending(null);
      }
    },
    [appendLog, autoEnabled, autoMinutes, cancelSchedule, note, saveSchedule, schedule, token],
  );

  const clearLog = useCallback(() => {
    setLog([]);
    localStorage.removeItem(LOG_KEY);
  }, []);

  return (
    <main className="page">
      <section className="card">
        <header className="head">
          <div>
            <h1>Keka Remote Punch</h1>
            <p className="sub">cloudanalogy.keka.com</p>
          </div>
          <div className="clock">{now ? formatTime(now) : "--:--:--"}</div>
        </header>

        <label className="label" htmlFor="token">
          Bearer token
        </label>
        <textarea
          id="token"
          className="token"
          spellCheck={false}
          placeholder="Paste the token from the Authorization header (eyJhbGciOi…)"
          value={token}
          onChange={(e) => saveToken(e.target.value)}
        />

        {info && (
          <p className={expired ? "meta bad" : "meta"}>
            {info.username ?? info.email ?? "unknown user"}
            {info.expiresAt &&
              (expired
                ? ` · token expired at ${info.expiresAt.toLocaleString()}`
                : ` · valid until ${info.expiresAt.toLocaleString()}`)}
          </p>
        )}
        {token.trim() && !info && <p className="meta bad">That does not look like a JWT.</p>}

        <label className="label" htmlFor="note">
          Note (optional)
        </label>
        <input
          id="note"
          className="note"
          value={note}
          placeholder="Leave blank for none"
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="auto">
          <label className="autoToggle">
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={(e) => setAutoEnabled(e.target.checked)}
            />
            <span>Auto clock-out after</span>
          </label>
          <div className="chips">
            {DURATIONS.map((d) => (
              <button
                key={d.minutes}
                type="button"
                className={autoMinutes === d.minutes ? "chip on" : "chip"}
                disabled={!autoEnabled}
                onClick={() => setAutoMinutes(d.minutes)}
              >
                {d.label}
              </button>
            ))}
            <input
              type="number"
              className="chipInput"
              min={1}
              max={960}
              disabled={!autoEnabled}
              value={autoMinutes}
              onChange={(e) => setAutoMinutes(Number(e.target.value))}
              aria-label="Minutes until auto clock-out"
            />
            <span className="chipUnit">min</span>
          </div>
          {autoEnabled && (
            <button
              type="button"
              className="schedOnly"
              onClick={scheduleOnly}
              disabled={scheduling || schedule !== null}
            >
              {schedule
                ? "Already scheduled"
                : scheduling
                  ? "Scheduling…"
                  : "Schedule without clocking in"}
            </button>
          )}
        </div>

        <div className="actions">
          <button className="btn in" onClick={() => punch("in")} disabled={pending !== null}>
            {pending === "in" ? "Clocking in…" : "Clock In"}
          </button>
          <button className="btn out" onClick={() => punch("out")} disabled={pending !== null}>
            {pending === "out" ? "Clocking out…" : "Clock Out"}
          </button>
        </div>

        {schedule && remaining !== null && remaining > 0 && (
          <div className="scheduled">
            <div>
              <span className="schedLabel">Auto clock-out in</span>
              <span className="schedTime">{formatCountdown(remaining)}</span>
              <span className="schedAt">at {formatTime(new Date(schedule.fireAt))}</span>
            </div>
            <span className="schedActions">
              <button className="link" onClick={checkStatus}>
                check
              </button>
              <button className="link" onClick={() => cancelSchedule()} disabled={cancelling}>
                {cancelling ? "cancelling…" : "cancel"}
              </button>
            </span>
          </div>
        )}

        {status && <p className={status.ok ? "status good" : "status bad"}>{status.message}</p>}

        {log.length > 0 && (
          <div className="log">
            <div className="logHead">
              <span>Recent</span>
              <button className="link" onClick={clearLog}>
                clear
              </button>
            </div>
            <ul>
              {log.map((entry, i) => (
                <li key={`${entry.at}-${i}`}>
                  <span className={entry.ok ? "dot good" : "dot bad"} />
                  <span className="logAction">{entry.action === "in" ? "IN" : "OUT"}</span>
                  <span className="logTime">{formatTime(new Date(entry.at))}</span>
                  <span className="logMsg">{entry.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <p className="footnote">
        The token stays in this browser and is only sent to Keka through this app&apos;s own server.
        Scheduling an auto clock-out sends an encrypted copy of it to QStash so the punch can happen
        while this tab is closed. Keka tokens expire after about 24 hours.
      </p>
    </main>
  );
}
