/**
 * Thin fetch wrapper that injects the Cognito access token and base URL,
 * and throws on non-2xx responses with a structured error.
 */
import { useConfig } from '../auth/useConfig';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let _token: string | null = null;

/** Called by AuthContext whenever the access token changes. */
export function setAuthToken(token: string | null) {
  _token = token;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  baseUrl?: string,
): Promise<T> {
  const url = `${baseUrl ?? ''}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
