import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const KEY_LEN = 64;
const PREFIX = "scrypt";

// 用户不存在时也执行一次等价开销的校验，降低邮箱枚举的时序差异
const DUMMY_HASH =
  "scrypt$B69q7CRU4h6APGsgebm5tg==$p9FDoDfQdj6ysuZ2ddCAEqMm89aREtBp4SpYcV4Egw0ZkjblPb0DLg2u7EA9bVztCJVpIUPxRj1YE8fGg7vOWw==";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN);
  return `${PREFIX}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null
): Promise<boolean> {
  const encoded = stored ?? DUMMY_HASH;
  const [prefix, saltRaw, hashRaw] = encoded.split("$");
  if (prefix !== PREFIX || !saltRaw || !hashRaw) return false;
  const salt = Buffer.from(saltRaw, "base64");
  const expected = Buffer.from(hashRaw, "base64");
  if (expected.length !== KEY_LEN) return false;
  const actual = await scrypt(password, salt, KEY_LEN);
  const ok = timingSafeEqual(actual, expected);
  return stored !== null && ok;
}