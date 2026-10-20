/**
 * Authenticated encryption for credentials the owner saves in the app.
 *
 * AES-256-GCM through Web Crypto, so Node and Workers run the same code. Each
 * value gets a fresh 12-byte IV, and the purpose string is bound as associated
 * data: a ciphertext copied into another column, or altered at all, fails to
 * open instead of decrypting to something else. The 32-byte key comes from the
 * host setting SETTINGS_ENCRYPTION_KEY when present; otherwise it is derived
 * with HKDF-SHA256 from the app secret (BETTER_AUTH_SECRET) under its own label,
 * so no extra setting is needed. Neither is ever stored in the database, and
 * changing either makes saved credentials unreadable until they are saved again.
 *
 * Stored form: "v1." + base64url(iv | ciphertext+tag). The version prefix leaves
 * room for key rotation; rotating today means saving the credential again after
 * changing the host key.
 */

const VERSION = "v1";
const IV_BYTES = 12;

/** Parses the 64-hex host key; anything else is refused rather than stretched. */
export function parseSettingsKey(hex: string | undefined): Uint8Array<ArrayBuffer> | null {
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Derives a 32-byte key for one purpose from the app secret. */
async function deriveKey(secret: string, label: string): Promise<Uint8Array<ArrayBuffer>> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode(label) },
    material,
    256,
  );
  return new Uint8Array(bits);
}

/** The settings key: the explicit host key when set, else one derived from the app secret. */
export async function resolveSettingsKey(config: { settingsKey?: string; authSecret: string }): Promise<Uint8Array<ArrayBuffer>> {
  return parseSettingsKey(config.settingsKey) ?? deriveKey(config.authSecret, "seller-desk/settings-encryption/v1");
}

async function importKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Encrypts `plaintext` for one purpose. */
export async function sealSecret(key: Uint8Array<ArrayBuffer>, purpose: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(purpose) },
      await importKey(key),
      new TextEncoder().encode(plaintext),
    ),
  );
  const out = new Uint8Array(IV_BYTES + sealed.length);
  out.set(iv);
  out.set(sealed, IV_BYTES);
  return `${VERSION}.${toBase64Url(out)}`;
}

/**
 * Decrypts a value sealed for `purpose`. Returns null for a wrong key, a
 * different purpose, an unknown version or any tampering; the reason is not
 * distinguished, so callers cannot be used as a decryption oracle.
 */
export async function openSecret(key: Uint8Array<ArrayBuffer>, purpose: string, stored: string): Promise<string | null> {
  const [version, body] = stored.split(".", 2);
  if (version !== VERSION || !body) return null;
  try {
    const bytes = fromBase64Url(body);
    if (bytes.length <= IV_BYTES + 16) return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, IV_BYTES), additionalData: new TextEncoder().encode(purpose) },
      await importKey(key),
      bytes.slice(IV_BYTES),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** A display form that identifies a key without revealing it: known prefix plus the last four. */
export function maskSecret(value: string): string {
  if (value.length < 12) return "••••";
  const prefix = /^(sk-ant-|sk-or-v1-|sk-proj-|sk-|AIza|vck_)/.exec(value)?.[0] ?? "";
  return `${prefix}••••${value.slice(-4)}`;
}
