import { Client, Receiver } from "@upstash/qstash";

export function qstashClient(): Client {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error("QSTASH_TOKEN is not set.");
  return new Client({ token });
}

export function qstashReceiver(): Receiver {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    throw new Error("QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY are not set.");
  }
  return new Receiver({ currentSigningKey, nextSigningKey });
}

/**
 * QStash calls us back from the outside, so the callback must be a public URL.
 *
 * On a preview deployment the callback has to hit *that* deployment, not
 * production — VERCEL_PROJECT_PRODUCTION_URL always points at production, so
 * using it from a preview aims the punch at code that may not exist there yet.
 *
 * The URL used to verify a callback signature must be byte-identical to the one
 * used to publish it, so both sides derive it from this same chain.
 */
export function callbackUrl(path: string, request?: Request): string {
  const explicit = process.env.AUTO_CLOCKOUT_BASE_URL?.replace(/\/+$/, "");
  if (explicit) return `${explicit}${path}`;

  const isProduction = process.env.VERCEL_ENV === "production";
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (isProduction && production) return `https://${production}${path}`;

  // Immutable per deployment, so a delayed callback lands on the exact build
  // that scheduled it.
  const deployment = process.env.VERCEL_URL;
  if (deployment) return `https://${deployment}${path}`;

  if (production) return `https://${production}${path}`;

  const host = request?.headers.get("x-forwarded-host") ?? request?.headers.get("host");
  if (host) {
    const proto =
      request?.headers.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}${path}`;
  }

  throw new Error(
    "No public callback URL. Set AUTO_CLOCKOUT_BASE_URL (e.g. https://your-app.vercel.app).",
  );
}

/**
 * Preview deployments sit behind Vercel Authentication, which answers QStash
 * with a login page instead of running the route. Vercel injects this secret
 * when "Protection Bypass for Automation" is on; forwarding it lets the
 * callback through without opening the deployment to everyone.
 */
export function bypassHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret ? { "x-vercel-protection-bypass": secret } : {};
}
