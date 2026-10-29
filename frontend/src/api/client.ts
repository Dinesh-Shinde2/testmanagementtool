const TOKEN_KEY = "tms_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function headers(init?: HeadersInit, json = true) {
  const h = new Headers(init);
  if (json && !h.has("Content-Type")) h.set("Content-Type", "application/json");
  const token = getToken();
  if (token) h.set("Authorization", `Bearer ${token}`);
  return h;
}

async function parseError(res: Response) {
  let detail = res.statusText;
  try {
    const body = await res.json();
    detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail || body);
  } catch {
    /* ignore */
  }
  throw new Error(detail);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(path, { ...init, headers: headers(init.headers, !isForm) });
  if (res.status === 401) {
    setToken("");
    if (!window.location.pathname.startsWith("/login")) window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) await parseError(res);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(path, { headers: headers(undefined, false) });
  if (!res.ok) await parseError(res);
  return res.blob();
}

export async function apiText(path: string): Promise<string> {
  const res = await fetch(path, { headers: headers(undefined, false) });
  if (!res.ok) await parseError(res);
  return res.text();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
