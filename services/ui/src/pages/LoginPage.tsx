import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const { signIn } = useAuth();
  return (
    <div className="h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm text-center space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-gray-900">Enterprise RAG</h1>
          <p className="text-sm text-gray-500">Sign in to continue</p>
        </div>
        <button
          onClick={signIn}
          className="w-full py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium transition-colors"
        >
          Sign in with SSO
        </button>
      </div>
    </div>
  );
}
