import { cookies } from "next/headers";

import { compare, hash } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const SESSION_COOKIE = "session";
const SESSION_DAYS = 7;
const SALT_ROUNDS = 10;

// Lazy key resolution — NEVER throw at module eval. `next build` imports this
// file and blows up the whole deployment if AUTH_SECRET happens to be missing
// at that moment. Defer to first actual sign/verify call instead.
let _key: Uint8Array | null = null;
function getKey(): Uint8Array {
  if (_key) return _key;
  const secret = process.env.AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_SECRET (or BETTER_AUTH_SECRET) is not set in production. " +
          "Generate with: openssl rand -base64 32",
      );
    }
    console.warn(
      "[auth] AUTH_SECRET not set — using dev fallback. Do NOT ship this.",
    );
  }
  _key = new TextEncoder().encode(secret ?? "dev-only-insecure-fallback");
  return _key;
}

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  // Back-compat fields that the old better-auth session exposed. They aren't
  // signed into the JWT today — accessing them returns undefined at runtime,
  // so we keep the shape nullable to satisfy legacy call sites. Since we
  // dropped i18n, `userLanguage` can be treated as always "en" by consumers.
  userLanguage?: string | null;
  userStatus?: string | null;
  image?: string | null;
  avatar?: string | null;
  username?: string | null;
};

export type SessionData = {
  user: SessionUser;
  expires: string;
};

export async function hashPassword(password: string) {
  return hash(password, SALT_ROUNDS);
}

export async function comparePasswords(
  plain: string,
  hashed: string,
): Promise<boolean> {
  return compare(plain, hashed);
}

export async function signSessionToken(payload: SessionData): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getKey());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionData | null> {
  try {
    const { payload } = await jwtVerify(token, getKey(), { algorithms: ["HS256"] });
    return payload as unknown as SessionData;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionData | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function setSession(user: SessionUser): Promise<void> {
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const token = await signSessionToken({
    user,
    expires: expires.toISOString(),
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    expires,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export { SESSION_COOKIE };
