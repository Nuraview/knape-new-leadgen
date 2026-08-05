import { getApiUrl } from "../get-api-url";
import type { Lead } from "./get-leads-view";

async function post(path: string, body: unknown): Promise<Lead> {
  const response = await fetch(getApiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      (await response.text()) || `Request failed (${response.status})`,
    );
  }

  return response.json();
}

export const setLeadHighlighted = (id: string, value: boolean) =>
  post(`lead/${id}/highlight`, { value });

export const setLeadContacted = (id: string, value: boolean) =>
  post(`lead/${id}/contacted`, { value });

export const setLeadIrrelevant = (id: string, value: boolean, reason?: string) =>
  post(`lead/${id}/irrelevant`, { value, reason });

export const setLeadReminder = (id: string, at: string | null, note?: string) =>
  post(`lead/${id}/reminder`, { at, note });
