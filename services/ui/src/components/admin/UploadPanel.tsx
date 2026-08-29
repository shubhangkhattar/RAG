import { useRef, useState } from 'react';
import { getPresignedUrl, uploadToS3 } from '../../api/admin';
import { useConfig } from '../../auth/useConfig';

const NAMESPACES = ['hr', 'it', 'finance', 'legal', 'general'];

export function UploadPanel({ onUploaded }: { onUploaded: () => void }) {
  const config = useConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const [namespace, setNamespace] = useState('hr');
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Record<string, 'uploading' | 'done' | 'error'>>({});
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };

  const removeFile = (name: string) =>
    setFiles((prev) => prev.filter((f) => f.name !== name));

  const uploadAll = async () => {
    if (!config || files.length === 0) return;
    for (const file of files) {
      setStatus((s) => ({ ...s, [file.name]: 'uploading' }));
      try {
        const { upload_url } = await getPresignedUrl(
          file.name, namespace, file.type || 'application/octet-stream', config.apiEndpoint,
        );
        await uploadToS3(upload_url, file);
        setStatus((s) => ({ ...s, [file.name]: 'done' }));
      } catch {
        setStatus((s) => ({ ...s, [file.name]: 'error' }));
      }
    }
    // Remove successfully uploaded files and notify parent to refresh status table
    setFiles((prev) => prev.filter((f) => status[f.name] !== 'done'));
    onUploaded();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-gray-700">Namespace</label>
        <select
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {NAMESPACES.map((n) => <option key={n}>{n}</option>)}
        </select>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-gray-400'
        }`}
      >
        <p className="text-sm text-gray-500">
          Drag files here or <span className="text-brand-500 font-medium">browse</span>
        </p>
        <p className="text-xs text-gray-400 mt-1">PDF, DOCX, XLSX, PNG, JPG</p>
        <input ref={inputRef} type="file" multiple className="hidden"
          accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg"
          onChange={(e) => addFiles(e.target.files)} />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 overflow-hidden">
          {files.map((f) => {
            const s = status[f.name];
            return (
              <li key={f.name} className="flex items-center gap-3 px-4 py-2.5 bg-white">
                <span className="flex-1 text-sm text-gray-700 truncate">{f.name}</span>
                <span className="text-xs text-gray-400">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
                {s === 'uploading' && <span className="text-xs text-blue-500 animate-pulse">Uploading…</span>}
                {s === 'done' && <span className="text-xs text-green-600">✓ Done</span>}
                {s === 'error' && <span className="text-xs text-red-500">✗ Failed</span>}
                {!s && (
                  <button onClick={() => removeFile(f.name)}
                    className="text-gray-400 hover:text-red-400 text-xs transition-colors">✕</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button
        onClick={uploadAll}
        disabled={files.length === 0 || Object.values(status).includes('uploading')}
        className="px-5 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-sm font-medium transition-colors"
      >
        Upload {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''}` : ''}
      </button>
    </div>
  );
}
