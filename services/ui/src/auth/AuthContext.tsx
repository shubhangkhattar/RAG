/**
 * Cognito PKCE authentication.
 *
 * Flow:
 *   1. User clicks Sign In → redirected to Cognito Hosted UI with PKCE challenge.
 *   2. After login Cognito redirects back with ?code=...
 *   3. We exchange the code for tokens at Cognito's /oauth2/token endpoint.
 *   4. Access token stored in memory; refresh token in sessionStorage (survives F5).
 *   5. Every API call includes the access token as Bearer.
 *
 * Tokens are NOT stored in localStorage to reduce XSS exposure surface.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useConfig } from './useConfig';

interface AuthState {
  accessToken: string | null;
  idToken: string | null;
  isAdmin: boolean;
  isLoading: boolean;
  signIn: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function randomBase64Url(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function sha256Base64Url(plain: string): Promise<string> {
  const enc = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function parseJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const exchangeStarted = useRef(false);

  const signIn = useCallback(() => {
    if (!config) return;
    const verifier = randomBase64Url(64);
    sessionStorage.setItem('pkce_verifier', verifier);
    sha256Base64Url(verifier).then((challenge) => {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: config.cognitoClientId,
        redirect_uri: config.cognitoRedirectUri,
        scope: 'email openid profile',
        code_challenge_method: 'S256',
        code_challenge: challenge,
      });
      window.location.href = `${config.cognitoDomain}/oauth2/authorize?${params}`;
    });
  }, [config]);

  const signOut = useCallback(() => {
    if (!config) return;
    setAccessToken(null);
    setIdToken(null);
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('refresh_token');
    const params = new URLSearchParams({
      client_id: config.cognitoClientId,
      logout_uri: config.cognitoRedirectUri,
    });
    window.location.href = `${config.cognitoDomain}/logout?${params}`;
  }, [config]);

  // Exchange authorization code for tokens on redirect-back
  useEffect(() => {
    if (!config || exchangeStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const verifier = sessionStorage.getItem('pkce_verifier');

    if (code && verifier) {
      exchangeStarted.current = true;
      // Clean the URL so the code doesn't sit in the address bar
      window.history.replaceState({}, '', window.location.pathname);

      fetch(`${config.cognitoDomain}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.cognitoClientId,
          redirect_uri: config.cognitoRedirectUri,
          code,
          code_verifier: verifier,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.access_token) {
            setAccessToken(data.access_token);
            setIdToken(data.id_token ?? null);
            if (data.refresh_token) {
              sessionStorage.setItem('refresh_token', data.refresh_token);
            }
          }
        })
        .finally(() => {
          sessionStorage.removeItem('pkce_verifier');
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, [config]);

  const isAdmin = (() => {
    if (!accessToken) return false;
    try {
      const payload = parseJwtPayload(accessToken);
      const roles = String(payload['custom:roles'] ?? '');
      return roles.split(',').map((r) => r.trim()).includes('admin');
    } catch {
      return false;
    }
  })();

  return (
    <AuthContext.Provider value={{ accessToken, idToken, isAdmin, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
