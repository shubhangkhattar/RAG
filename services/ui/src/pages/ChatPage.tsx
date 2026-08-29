import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { useConfig } from '../auth/useConfig';
import { sendMessage } from '../api/chat';
import type { Message } from '../api/chat';
import { SessionSidebar } from '../components/chat/SessionSidebar';
import { MessageList } from '../components/chat/MessageList';
import { ChatInput } from '../components/chat/ChatInput';

export default function ChatPage() {
  const { isAdmin, signOut } = useAuth();
  const config = useConfig();
  const qc = useQueryClient();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Clear messages when switching sessions
  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [sessionId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = async (query: string) => {
    if (!config) return;
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: query }]);
    setIsLoading(true);

    try {
      const res = await sendMessage(query, sessionId, config.apiEndpoint);
      setSessionId(res.session_id);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.answer,
          citations: res.citations,
          cache_hit: res.cache_hit,
        },
      ]);
      qc.invalidateQueries({ queryKey: ['sessions'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setMessages((prev) => prev.slice(0, -1)); // remove optimistic user message
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen flex overflow-hidden">
      <SessionSidebar
        activeSessionId={sessionId}
        onSelect={(id) => setSessionId(id)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex-none h-14 border-b border-gray-200 bg-white flex items-center justify-between px-6">
          <h1 className="text-sm font-semibold text-gray-900">Enterprise RAG</h1>
          <div className="flex items-center gap-4">
            {isAdmin && (
              <Link
                to="/admin"
                className="text-xs text-brand-500 hover:text-brand-600 font-medium"
              >
                Admin Panel
              </Link>
            )}
            <button
              onClick={signOut}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* Messages */}
        <MessageList messages={messages} isLoading={isLoading} />
        <div ref={bottomRef} />

        {/* Error banner */}
        {error && (
          <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600">
            {error}
          </div>
        )}

        <ChatInput onSend={handleSend} disabled={isLoading || !config} />
      </div>
    </div>
  );
}
