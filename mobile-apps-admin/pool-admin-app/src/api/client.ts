import Constants from 'expo-constants';
import { getSecureItem, setSecureItem, StorageKeys } from '@/utils/storage';

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

let cachedBase: string | null = null;
let cachedCookie: string | null = null;

export async function getApiBaseUrl(): Promise<string> {
  if (cachedBase) return cachedBase;
  const stored = await getSecureItem(StorageKeys.apiBaseUrl);
  if (stored) {
    cachedBase = stored;
    return stored;
  }
  const fallback =
    (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)
      ?.apiBaseUrl ?? 'http://localhost:3000';
  cachedBase = fallback;
  return fallback;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  cachedBase = url;
  await setSecureItem(StorageKeys.apiBaseUrl, url);
}

export async function getSessionCookie(): Promise<string | null> {
  if (cachedCookie) return cachedCookie;
  const v = await getSecureItem(StorageKeys.sessionCookie);
  cachedCookie = v;
  return v;
}

export async function setSessionCookie(cookie: string | null): Promise<void> {
  cachedCookie = cookie;
  if (cookie) await setSecureItem(StorageKeys.sessionCookie, cookie);
}

export interface ApiOptions extends RequestInit {
  timeoutMs?: number;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const base = await getApiBaseUrl();
  const cookie = await getSessionCookie();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15000,
  );

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (cookie) headers['Cookie'] = cookie;

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    throw new ApiError((e as Error).message || 'Network error', 0);
  }
  clearTimeout(timeout);

  // Capture session cookie on login responses
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && /connect\.sid=/.test(setCookie)) {
    const match = setCookie.match(/connect\.sid=[^;]+/);
    if (match) await setSessionCookie(match[0]);
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : null) ||
      (typeof data === 'string' ? data : null) ||
      `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, data);
  }

  return data as T;
}
