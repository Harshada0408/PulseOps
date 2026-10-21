'use client';

import { useState, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api-client';

export function useAuth() {
  const {
    user,
    isAuthenticated,
    isLoading,
    setUser,
    setLoading,
    setInitialized,
    logout,
  } = useAuthStore();

  const [error, setError] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      // Already authenticated, skip duplicate request
      if (user && isAuthenticated) {
        return;
      }

      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;

      if (!token) {
        logout();
        return;
      }

      setLoading(true);

      const { data } = await api.get('/auth/me');

      if (data?.user) {
        setUser(data.user);
      } else {
        logout();
      }

    } catch (err) {
      console.error('Auth check failed:', err);
      logout();
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, [user, isAuthenticated, setLoading, logout, setUser, setInitialized]);

  const signIn = async (email: string, password: string) => {
    try {
      setError(null);

      const { data } = await api.post('/auth/signin', { email, password });

      if (!data?.session?.access_token) {
        throw new Error('No session returned');
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('access_token', data.session.access_token);
        localStorage.setItem('refresh_token', data.session.refresh_token);
      }

      const { data: userData } = await api.get('/auth/me');

      if (!userData?.user) {
        throw new Error('Failed to load user profile');
      }

      setUser(userData.user);

      return { success: true };

    } catch (err: any) {
      const message = err?.message || 'Failed to sign in';
      setError(message);
      return { success: false, error: message };
    }
  };

  const signUp = async (email: string, password: string, name?: string) => {
    try {
      setError(null);

      const { data } = await api.post('/auth/signup', {
        email,
        password,
        name,
      });

      // Local auth mode returns a session immediately; Supabase mode asks for e-mail verification.
      if (data?.session?.access_token && typeof window !== 'undefined') {
        localStorage.setItem('access_token', data.session.access_token);
        localStorage.setItem('refresh_token', data.session.refresh_token);
        const me = await api.get('/auth/me');
        if (me.data?.user) setUser(me.data.user);
        return { success: true, message: 'Account created', signedIn: true };
      }

      return {
        success: true,
        message: 'Check your email to verify your account',
        signedIn: false,
      };

    } catch (err: any) {
      const message = err?.message || 'Failed to sign up';
      setError(message);
      return { success: false, error: message };
    }
  };

  const signOut = async () => {
    try {
      await api.post('/auth/signout');
    } catch {
      // stateless tokens: nothing to revoke server-side
    } finally {
      logout();
    }
  };

  return {
    user,
    isAuthenticated,
    isLoading,
    error,
    signIn,
    signUp,
    signOut,
    checkAuth,
  };
}