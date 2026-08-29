import { useRef, useState } from 'react';

interface Props {
  onSend: (query: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const q = value.trim();
    if (!q || disabled) return;
    setValue('');
    onSend(q);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      <div className="flex gap-2 items-end max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm
                     focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
                     disabled:opacity-50 disabled:bg-gray-50 max-h-40 overflow-y-auto"
          style={{ fieldSizing: 'content' } as React.CSSProperties}
        />
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="flex-none h-10 w-10 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40
                     text-white flex items-center justify-center transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
