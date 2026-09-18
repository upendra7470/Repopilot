import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { getEnv } from "../config/env.js";
import { getLogger } from "../utils/logger.js";

let _ephemeralSecret: string | null = null;
let _warnedEphemeral = false;

/**
 * Secret used to sign session cookies and to derive the key that encrypts
 * stored OAuth credentials.
 *
 * When AUTH_SECRET is not configured (local development), an ephemeral
 * per-process secret is generated so the server still starts; sessions and
 * stored credentials do not survive restarts in that mode and a warning is
 * logged. Production deployments must set a stable AUTH_SECRET.
 */
export function getAuthSecret(): string {
  const env = getEnv();
  if (env.AUTH_SECRET) {
    return env.AUTH_SECRET;
  }
  if (!_ephemeralSecret) {
    _ephemeralSecret = randomBytes(32).toString("hex");
  }
  if (!_warnedEphemeral) {
    _warnedEphemeral = true;
    getLogger().warn(
      "AUTH_SECRET is not set; using an ephemeral secret. " +
        "Sessions will not survive restarts. Set AUTH_SECRET in production.",
    );
  }
  return _ephemeralSecret;
}

/** Generate a new random session token (stored in the session cookie). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash a session token for database storage, so a database read alone never
 * yields a usable cookie value.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(getAuthSecret(), "utf8").digest();
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

/** Encrypt a provider token with AES-256-GCM. Never log the plaintext. */
export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}

/** Decrypt a value produced by {@link encryptSecret}. */
export function decryptSecret(encrypted: EncryptedSecret): string {
  const key = encryptionKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encrypted.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
