import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { loadKey } from "./keys.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MIN_ENCRYPTED_SIZE = IV_LENGTH + AUTH_TAG_LENGTH + 1; // At least 1 byte of ciphertext

/**
 * Encrypt data using AES-256-GCM
 * Returns: IV (12 bytes) + Auth Tag (16 bytes) + Ciphertext
 */
export async function encrypt(data: string | Buffer): Promise<Buffer> {
  const key = await loadKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const input = typeof data === "string" ? Buffer.from(data, "utf-8") : data;

  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: IV + AuthTag + Ciphertext
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt data encrypted with encrypt()
 */
export async function decrypt(encryptedData: Buffer): Promise<string> {
  const key = await loadKey();

  // Extract components
  const iv = encryptedData.subarray(0, IV_LENGTH);
  const authTag = encryptedData.subarray(
    IV_LENGTH,
    IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = encryptedData.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

/**
 * Encrypt with a specific key (for testing or key rotation)
 */
export function encryptWithKey(data: string | Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const input = typeof data === "string" ? Buffer.from(data, "utf-8") : data;

  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt with a specific key (for testing or key rotation)
 */
export function decryptWithKey(encryptedData: Buffer, key: Buffer): string {
  const iv = encryptedData.subarray(0, IV_LENGTH);
  const authTag = encryptedData.subarray(
    IV_LENGTH,
    IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = encryptedData.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

/**
 * Validate that data looks like it was encrypted by us.
 * Checks minimum size and attempts to verify structure.
 * This is a safety check to prevent accidentally pushing unencrypted data.
 */
export function isEncrypted(data: Buffer): boolean {
  // Must be at least IV + AuthTag + 1 byte of ciphertext
  if (data.length < MIN_ENCRYPTED_SIZE) {
    return false;
  }

  // Check it's not plain text (JSONL sessions start with '{')
  // If the first byte is a printable ASCII char that's common in JSON, it's likely not encrypted
  const firstByte = data[0];
  const plainTextIndicators = [
    0x7b, // {
    0x5b, // [
    0x22, // "
    0x23, // #
  ];

  if (plainTextIndicators.includes(firstByte)) {
    return false;
  }

  return true;
}

/**
 * Verify data is encrypted before allowing it to be pushed.
 * Throws an error if data appears to be unencrypted.
 */
export function assertEncrypted(data: Buffer, context?: string): void {
  if (!isEncrypted(data)) {
    const ctx = context ? ` (${context})` : "";
    throw new Error(
      `Security error: Attempted to push unencrypted data${ctx}. ` +
        "This is a safety check to prevent accidental exposure of session data."
    );
  }
}
