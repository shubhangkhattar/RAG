import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createUser, deleteUser, getUsers, updateUser } from '../../api/admin';
import type { User } from '../../api/admin';
import { useConfig } from '../../auth/useConfig';

const NAMESPACES = ['hr', 'it', 'finance', 'legal', 'general'];

export function UserTable() {
  const config = useConfig();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState({ email: '', namespace: 'hr', roles: 'user', temp_password: '' });
  const [editForm, setEditForm] = useState({ namespace: '', roles: '' });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => getUsers(config!.apiEndpoint),
    enabled: !!config,
  });

  const createMut = useMutation({
    mutationFn: () => createUser({ ...form }, config!.apiEndpoint),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setShowCreate(false); },
  });

  const updateMut = useMutation({
    mutationFn: (u: User) => updateUser(u.username, editForm, config!.apiEndpoint),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setEditingUser(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (username: string) => deleteUser(username, config!.apiEndpoint),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const startEdit = (u: User) => {
    setEditingUser(u);
    setEditForm({ namespace: u.namespace, roles: u.roles });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium"
        >
          + Add User
        </button>
      </div>

      {/* Create user modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-base font-semibold">New User</h3>
            {(['email', 'temp_password'] as const).map((field) => (
              <div key={field} className="space-y-1">
                <label className="text-xs font-medium text-gray-600 capitalize">
                  {field.replace('_', ' ')}
                </label>
                <input
                  type={field === 'temp_password' ? 'password' : 'email'}
                  value={form[field]}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">Namespace</label>
              <select value={form.namespace} onChange={(e) => setForm((f) => ({ ...f, namespace: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {NAMESPACES.map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">Roles (comma-separated)</label>
              <input value={form.roles}
                onChange={(e) => setForm((f) => ({ ...f, roles: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={() => createMut.mutate()}
                disabled={createMut.isPending || !form.email || !form.temp_password}
                className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-sm font-medium">
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit user modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-base font-semibold">Edit {editingUser.email}</h3>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">Namespace</label>
              <select value={editForm.namespace}
                onChange={(e) => setEditForm((f) => ({ ...f, namespace: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {NAMESPACES.map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">Roles</label>
              <input value={editForm.roles}
                onChange={(e) => setEditForm((f) => ({ ...f, roles: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingUser(null)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={() => updateMut.mutate(editingUser)}
                disabled={updateMut.isPending}
                className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white text-sm font-medium">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Namespace</th>
              <th className="text-left px-4 py-3">Roles</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {users.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No users</td></tr>
            )}
            {users.map((u) => (
              <tr key={u.username} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-800">{u.email}</td>
                <td className="px-4 py-3"><span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{u.namespace}</span></td>
                <td className="px-4 py-3 text-gray-500 text-xs">{u.roles}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${u.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {u.status.toLowerCase().replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <button onClick={() => startEdit(u)} className="text-xs text-brand-500 hover:text-brand-700">Edit</button>
                    <button onClick={() => { if (confirm(`Delete ${u.email}?`)) deleteMut.mutate(u.username); }}
                      className="text-xs text-red-400 hover:text-red-600">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
