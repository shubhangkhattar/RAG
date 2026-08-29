import type { Message } from '../../api/chat';
import { CitationCard } from './CitationCard';

interface Props {
  messages: Message[];
  isLoading: boolean;
}

export function MessageList({ messages, isLoading }: Props) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
      {messages.length === 0 && !isLoading && (
        <div className="h-full flex items-center justify-center text-gray-400 text-sm">
          Ask anything about your documents.
        </div>
      )}

      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-2xl w-full space-y-2 ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
            <div
              className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-brand-500 text-white rounded-br-sm'
                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'
              }`}
            >
              {msg.content}
            </div>

            {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
              <div className="w-full space-y-1.5">
                <p className="text-xs text-gray-400 font-medium pl-1">Sources</p>
                {msg.citations.map((c, ci) => (
                  <CitationCard key={c.chunk_id} citation={c} index={ci} />
                ))}
              </div>
            )}

            {msg.role === 'assistant' && msg.cache_hit && (
              <span className="text-xs text-gray-400 pl-1">⚡ cached response</span>
            )}
          </div>
        </div>
      ))}

      {isLoading && (
        <div className="flex justify-start">
          <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
            <div className="flex gap-1 items-center h-4">
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
