import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
id: string;
email: string;
name?: string | null;
avatar?: string | null;
subscription?: {
plan: string;
status: string;
};
monitorCount?: number;
}

interface AuthState {
user: User | null;
isLoading: boolean;
isAuthenticated: boolean;
isInitialized: boolean;

setUser: (user: User | null) => void;
setLoading: (loading: boolean) => void;
setInitialized: (initialized: boolean) => void;

logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      isInitialized: false,

      setUser: (user) =>
        set({
          user,
          isAuthenticated: !!user,
          isLoading: false,
          isInitialized: true,
        }),

      setLoading: (loading) =>
        set({
          isLoading: loading,
        }),

      setInitialized: (initialized) =>
        set({
          isInitialized: initialized,
        }),

      logout: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
        }

        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: true,
        });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
      }),
      // Enable persistence only on the client
      storage: {
        getItem: () => {
          if (typeof window !== 'undefined') {
            const item = localStorage.getItem('auth-storage');
            return item ? JSON.parse(item) : null;
          }
          return null;
        },
        setItem: (key: string, value: any) => {
          if (typeof window !== 'undefined') {
            localStorage.setItem(key, JSON.stringify(value));
          }
        },
        removeItem: (key: string) => {
          if (typeof window !== 'undefined') {
            localStorage.removeItem(key);
          }
        },
      },
    }
  )
);