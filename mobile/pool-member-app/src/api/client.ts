import Constants from 'expo-constants';
import { getSecureItem, setSecureItem, StorageKeys } from '@/utils/storage';

/**
 * Lightweight HTTP client around the existing HOA backend. Persists a session
 * cookie returned by `/api/login` so subsequent calls keep the user signed in.
 */

let cachedBaseUrl: string | null = null;
let cachedCookie: string | null = null;

export async function getApiBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  const stored = await getSecureItem(StorageKeys.apiBaseUrl);
  if (stored) {
    cachedBaseUrl = stored;
    return stored;
  }
  const fromConfig =
    (Constants.expoConfig?.extra as Record<string, string> | undefined)?.apiBaseUrl ||
    'http://localhost:3000';
  cachedBaseUrl = fromConfig;
  return fromConfig;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  const cleaned = url.replace(/\/+$/, '');
  cachedBaseUrl = cleaned;
  await setSecureItem(StorageKeys.apiBaseUrl, cleaned);
}

export async function getSessionCookie(): Promise<string | null> {
  if (cachedCookie !== null) return cachedCookie;
  cachedCookie = await getSecureItem(StorageKeys.sessionCookie);
  return cachedCookie;
}

export async function setSessionCookie(cookie: string | null): Promise<void> {
  cachedCookie = cookie;
  if (cookie) {
    await setSecureItem(StorageKeys.sessionCookie, cookie);
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const baseUrl = await getApiBaseUrl();
  const cookie = await getSessionCookie();
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15000,
  );

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  // Capture session cookie when present (e.g., after /api/login).
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const sessionPart = setCookie.split(',').find((c) => c.includes('connect.sid'));
    if (sessionPart) {
      const cookieValue = sessionPart.split(';')[0];
      if (cookieValue) await setSessionCookie(cookieValue);
    }
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) ||
      `HTTP ${res.status}`;
    throw new ApiError(res.status, String(message), data);
  }

  return data as T;
}
