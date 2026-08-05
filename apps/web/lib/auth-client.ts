"use client";

// Simple client-side auth helpers. The former better-auth client exported
// `authClient.signIn.*`, `authClient.signOut`, `authClient.useSession`, plus
// plugin-specific APIs (`emailOtp`, `social`). The email+password flow we use
// only needs signIn/signOut/useSession, and LoginComponent handles signIn
// directly via fetch — so this file exposes just signOut/useSession.

import useSWR, { mutate } from "swr";

import type { SessionUser } from "./auth/session";

async function jsonFetcher(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function signIn(email: string, password: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: body?.error ?? "Login failed", data: null };
  }
  // Invalidate any cached session so components re-fetch.
  mutate("/api/auth/me");
  return { error: null, data: body.user as SessionUser };
}

export async function signOut() {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  mutate("/api/auth/me", null, { revalidate: false });
  return { error: null };
}

export function useSession() {
  const { data, error, isLoading, mutate: revalidate } = useSWR<{
    user: SessionUser;
  }>("/api/auth/me", jsonFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  return {
    data: data ? { user: data.user } : null,
    error,
    isPending: isLoading,
    refetch: revalidate,
  };
}

export const authClient = {
  signIn,
  signOut,
  useSession,
};
