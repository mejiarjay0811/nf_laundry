import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SessionUser } from '@shared/types';
import {
  can as hasCapability,
  isOwnerRole,
  type Capability,
} from '@shared/permissions';
import { ApiError, api, getToken, setToken } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';

interface AuthState {
  user: SessionUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
}

interface AuthApi extends AuthState {
  login: (username: string, password: string, remember: boolean) => Promise<SessionUser>;
  logout: () => Promise<void>;
  /** Owner-level: the proprietor's view of the books, the staff and the settings. */
  isAdmin: boolean;
  /**
   * Whether this account holds a named permission.
   *
   * Reading the same table the server enforces, so the interface offers only
   * what the API would actually allow. It is a courtesy, never a control —
   * every one of these is checked again on the server.
   */
  can: (capability: Capability) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, status: 'loading' });

  const refresh = useCallback(async () => {
    // With no token there is nothing to validate, and asking anyway would cost
    // a slow round trip to the backend before the sign-in screen could appear.
    if (!getToken()) {
      setState({ user: null, status: 'anonymous' });
      return;
    }
    try {
      const response = await api.get<{ user: SessionUser }>('/auth/me');
      setState({ user: response.user, status: 'authenticated' });
    } catch {
      setState({ user: null, status: 'anonymous' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Any 401 from anywhere in the app drops the session, so an expired token
   * sends the cashier back to the sign-in screen instead of leaving them
   * clicking on dead buttons.
   */
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const error = event.query.state.error;
      if (error instanceof ApiError && (error.status === 401 || error.code === 'SESSION_EXPIRED')) {
        setState({ user: null, status: 'anonymous' });
      }
    });
    return unsubscribe;
  }, []);

  const login = useCallback(async (username: string, password: string, remember: boolean) => {
    const response = await api.post<{ user: SessionUser }>('/auth/login', {
      username,
      password,
      remember,
    });
    queryClient.clear();
    setState({ user: response.user, status: 'authenticated' });
    return response.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      // Sign out locally even if the audit call could not be delivered —
      // leaving a usable token behind on a shared till would be worse.
      setToken(null);
      queryClient.clear();
      setState({ user: null, status: 'anonymous' });
    }
  }, []);

  const value = useMemo<AuthApi>(
    () => ({
      ...state,
      login,
      logout,
      refresh,
      isAdmin: state.user ? isOwnerRole(state.user.role) : false,
      can: (capability: Capability) =>
        state.user ? hasCapability(state.user.role, capability) : false,
    }),
    [state, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
