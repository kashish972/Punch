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

const TOKEN_KEY = "keka.token";
const LOG_KEY = "keka.log";

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

export default function Home() {
  const [token, setToken] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY) ?? "");
    try {
      setLog(JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]") as LogEntry[]);
    } catch {
      setLog([]);
    }
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const info = useMemo(() => (token.trim() ? decodeToken(token) : null), [token]);
  const expired = info?.expiresAt ? info.expiresAt.getTime() < Date.now() : false;

  const saveToken = useCallback((value: string) => {
    setToken(value);
    localStorage.setItem(TOKEN_KEY, value);
  }, []);

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
        const message = ok
          ? `Clocked ${action} at ${formatTime(new Date(data.timestamp ?? Date.now()))}`
          : data.error ?? `Request failed (${res.status}).`;
        setStatus({ ok, message });
        setLog((prev) => {
          const next = [{ action, at: new Date().toISOString(), ok, message }, ...prev].slice(0, 20);
          localStorage.setItem(LOG_KEY, JSON.stringify(next));
          return next;
        });
      } catch (err) {
        setStatus({ ok: false, message: (err as Error).message });
      } finally {
        setPending(null);
      }
    },
    [note, token],
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

        <div className="actions">
          <button
            className="btn in"
            onClick={() => punch("in")}
            disabled={pending !== null}
          >
            {pending === "in" ? "Clocking in…" : "Clock In"}
          </button>
          <button
            className="btn out"
            onClick={() => punch("out")}
            disabled={pending !== null}
          >
            {pending === "out" ? "Clocking out…" : "Clock Out"}
          </button>
        </div>

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
        Keka tokens expire after about 24 hours — paste a fresh one when clocking fails with 401.
      </p>
    </main>
  );
}
