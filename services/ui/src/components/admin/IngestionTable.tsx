import { useQuery } from '@tanstack/react-query';
import { getIngestionStatus } from '../../api/admin';
import type { DocumentStatus } from '../../api/admin';
import { useConfig } from '../../auth/useConfig';

const statusBadge: Record<DocumentStatus['status'], string> = {
  indexed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
};

export function IngestionTable({ refreshKey }: { refreshKey: number }) {
  const config = useConfig();

  const { data = [], isFetching } = useQuery<DocumentStatus[]>({
    queryKey: ['ingestion-status', refreshKey],
    queryFn: () => getIngestionStatus(null, config!.apiEndpoint),
    enabled: !!config,
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{data.length} document{data.length !== 1 ? 's' : ''}</p>
        {isFetching && <span className="text-xs text-gray-400 animate-pulse">Refreshing…</span>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">File</th>
              <th className="text-left px-4 py-3">Namespace</th>
              <th className="text-left px-4 py-3">Size</th>
              <th className="text-left px-4 py-3">Uploaded</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">
                  No documents uploaded yet
                </td>
              </tr>
            )}
            {data.map((doc) => (
              <tr key={doc.s3_key} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-800 max-w-xs truncate">{doc.filename}</td>
                <td className="px-4 py-3 text-gray-500">
                  <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs">{doc.namespace}</span>
                </td>
                <td className="px-4 py-3 text-gray-500">{(doc.size_bytes / 1024).toFixed(0)} KB</td>
                <td className="px-4 py-3 text-gray-500">
                  {new Date(doc.uploaded_at).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge[doc.status]}`}>
                    {doc.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
