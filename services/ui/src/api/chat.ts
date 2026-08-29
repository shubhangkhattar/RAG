import { apiFetch } from './client';

export interface Citation {
  chunk_id: string;
  source_key: string;
  page_number: number;
  section_heading: string;
  text_excerpt: string;
}

export interface ChatResponse {
  session_id: string;
  answer: string;
  citations: Citation[];
  rewritten_query: string;
  cache_hit: boolean;
}

export interface SessionSummary {
  session_id: string;
  created_at: string;
  message_count: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  cache_hit?: boolean;
}

export async function sendMessage(
  query: string,
  sessionId: string | null,
  apiBase: string,
): Promise<ChatResponse> {
  return apiFetch<ChatResponse>(
    '/v1/chat',
    {
      method: 'POST',
      body: JSON.stringify({ query, session_id: sessionId }),
    },
    apiBase,
  );
}

export async function getSessions(apiBase: string): Promise<SessionSummary[]> {
  return apiFetch<SessionSummary[]>('/v1/sessions', {}, apiBase);
}

export async function deleteSession(sessionId: string, apiBase: string): Promise<void> {
  return apiFetch<void>(`/v1/sessions/${sessionId}`, { method: 'DELETE' }, apiBase);
}
