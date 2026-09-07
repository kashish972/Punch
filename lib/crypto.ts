import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The Keka token is handed to QStash so it can be replayed hours later, which
 * means it sits in someone else's queue in the meantime. Sealing it here keeps
 * that copy useless to anyone without TOKEN_ENC_KEY.
 */
function key(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENC_KEY is not set. Generate one with: openssl rand -base64 32");
  }
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) {
    throw new Error(
      `TOKEN_ENC_KEY must be 32 bytes base64-encoded (got ${bytes.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  return bytes;
}

export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

export function open(sealed: string): string {
  const buf = Buffer.from(sealed, "base64url");
  if (buf.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("Sealed payload is malformed.");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const body = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
