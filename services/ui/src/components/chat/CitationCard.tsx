import { useState } from 'react';
import type { Citation } from '../../api/chat';

export function CitationCard({ citation, index }: { citation: Citation; index: number }) {
  const [open, setOpen] = useState(false);
  const filename = citation.source_key.split('/').pop() ?? citation.source_key;

  return (
    <button
      onClick={() => setOpen((o) => !o)}
      className="text-left w-full group"
    >
      <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 hover:bg-gray-100 transition-colors">
        <span className="mt-0.5 flex-none text-xs font-semibold text-brand-500 bg-brand-50 rounded px-1.5 py-0.5">
          [{index + 1}]
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-700 truncate">{filename}</p>
          <p className="text-xs text-gray-500">
            p.{citation.page_number}
            {citation.section_heading ? ` · ${citation.section_heading}` : ''}
          </p>
          {open && (
            <p className="mt-1.5 text-xs text-gray-600 italic border-l-2 border-brand-300 pl-2">
              "{citation.text_excerpt}"
            </p>
          )}
        </div>
        <span className="text-gray-400 text-xs flex-none">{open ? '▲' : '▼'}</span>
      </div>
    </button>
  );
}
