import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionSummary } from '../../api/chat';
import { getSessions, deleteSession } from '../../api/chat';
import { useConfig } from '../../auth/useConfig';

interface Props {
  activeSessionId: string | null;
  onSelect: (id: string | null) => void;
}

export function SessionSidebar({ activeSessionId, onSelect }: Props) {
  const config = useConfig();
  const qc = useQueryClient();

  const { data: sessions = [] } = useQuery<SessionSummary[]>({
    queryKey: ['sessions'],
    queryFn: () => getSessions(config!.apiEndpoint),
    enabled: !!config,
    refetchInterval: 15_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSession(id, config!.apiEndpoint),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      if (activeSessionId === id) onSelect(null);
    },
  });

  return (
    <aside className="w-60 flex-none bg-gray-900 text-gray-100 flex flex-col h-full">
      <div className="p-4 border-b border-gray-700">
        <button
          onClick={() => onSelect(null)}
          className="w-full py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors"
        >
          + New Chat
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.length === 0 && (
          <p className="text-xs text-gray-500 px-2 pt-4">No sessions yet</p>
        )}
        {sessions.map((s) => (
          <div
            key={s.session_id}
            className={`group flex items-center gap-1 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
              s.session_id === activeSessionId
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
            onClick={() => onSelect(s.session_id)}
          >
            <span className="flex-1 text-sm truncate">
              {new Date(s.created_at).toLocaleDateString()}
            </span>
            <span className="text-xs text-gray-500 flex-none">{s.message_count / 2 | 0}t</span>
            <button
              className="flex-none opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity text-xs px-1"
              onClick={(e) => { e.stopPropagation(); deleteMut.mutate(s.session_id); }}
              title="Delete session"
            >
              ✕
            </button>
          </div>
        ))}
      </nav>
    </aside>
  );
}
