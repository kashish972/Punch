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
 * Falls back through Vercel's system vars, then the incoming request's own host,
 * so a plain deploy works without configuration.
 *
 * The URL used to verify a callback signature must be byte-identical to the one
 * used to publish it — deriving both from the same chain keeps them in step.
 */
export function callbackUrl(path: string, request?: Request): string {
  const explicit = process.env.AUTO_CLOCKOUT_BASE_URL?.replace(/\/+$/, "");
  if (explicit) return `${explicit}${path}`;

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}${path}`;

  const deployment = process.env.VERCEL_URL;
  if (deployment) return `https://${deployment}${path}`;

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
