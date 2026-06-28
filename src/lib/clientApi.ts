"use client";

/**
 * Client fetch wrapper. On 401 (expired/invalid session) it redirects to the
 * login page so the UI never silently breaks. Returns parsed JSON + status.
 */
export async function jsonFetch(
  input: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }

  if (res.status === 401 && typeof window !== "undefined") {
    const locale = window.location.pathname.split("/")[1] || "az";
    window.location.href = `/${locale}/login`;
    return { ok: false, status: 401, data: {} };
  }

  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  return { ok: res.ok, status: res.status, data };
}
