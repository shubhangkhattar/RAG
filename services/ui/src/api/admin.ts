import { apiFetch } from './client';

export interface DocumentStatus {
  filename: string;
  namespace: string;
  s3_key: string;
  size_bytes: number;
  uploaded_at: string;
  status: 'indexed' | 'pending' | 'processing';
}

export interface User {
  username: string;
  email: string;
  namespace: string;
  roles: string;
  enabled: boolean;
  status: string;
}

export interface CreateUserPayload {
  email: string;
  namespace: string;
  roles: string;
  temp_password: string;
}

export interface UpdateUserPayload {
  namespace?: string;
  roles?: string;
}

export async function getPresignedUrl(
  filename: string,
  namespace: string,
  contentType: string,
  apiBase: string,
): Promise<{ upload_url: string; s3_key: string }> {
  return apiFetch(
    '/v1/admin/presigned-upload',
    { method: 'POST', body: JSON.stringify({ filename, namespace, content_type: contentType }) },
    apiBase,
  );
}

export async function uploadToS3(url: string, file: File): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`);
}

export async function getIngestionStatus(
  namespace: string | null,
  apiBase: string,
): Promise<DocumentStatus[]> {
  const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  return apiFetch(`/v1/admin/ingestion-status${qs}`, {}, apiBase);
}

export async function getUsers(apiBase: string): Promise<User[]> {
  return apiFetch('/v1/admin/users', {}, apiBase);
}

export async function createUser(payload: CreateUserPayload, apiBase: string): Promise<User> {
  return apiFetch('/v1/admin/users', { method: 'POST', body: JSON.stringify(payload) }, apiBase);
}

export async function updateUser(
  username: string,
  payload: UpdateUserPayload,
  apiBase: string,
): Promise<User> {
  return apiFetch(
    `/v1/admin/users/${encodeURIComponent(username)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
    apiBase,
  );
}

export async function deleteUser(username: string, apiBase: string): Promise<void> {
  return apiFetch(
    `/v1/admin/users/${encodeURIComponent(username)}`,
    { method: 'DELETE' },
    apiBase,
  );
}
