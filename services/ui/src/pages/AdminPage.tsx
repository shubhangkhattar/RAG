import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { UploadPanel } from '../components/admin/UploadPanel';
import { IngestionTable } from '../components/admin/IngestionTable';
import { UserTable } from '../components/admin/UserTable';

type Tab = 'upload' | 'documents' | 'users';

const TABS: { id: Tab; label: string }[] = [
  { id: 'upload', label: 'Upload Documents' },
  { id: 'documents', label: 'Ingestion Status' },
  { id: 'users', label: 'User Management' },
];

export default function AdminPage() {
  const { signOut } = useAuth();
  const [tab, setTab] = useState<Tab>('upload');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <Link to="/chat" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            ← Chat
          </Link>
          <h1 className="text-sm font-semibold text-gray-900">Admin Panel</h1>
        </div>
        <button onClick={signOut} className="text-xs text-gray-400 hover:text-gray-600">Sign out</button>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'bg-brand-500 text-white'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Panel */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          {tab === 'upload' && (
            <UploadPanel onUploaded={() => { setRefreshKey((k) => k + 1); setTab('documents'); }} />
          )}
          {tab === 'documents' && <IngestionTable refreshKey={refreshKey} />}
          {tab === 'users' && <UserTable />}
        </div>
      </div>
    </div>
  );
}
