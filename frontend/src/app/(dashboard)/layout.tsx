'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { DashboardShell } from '@/components/layout/shell';
import { useAuth } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth-store';

export default function DashboardLayout({
children,
}: {
children: React.ReactNode;
}) {
const router = useRouter();

// Call useAuth for any side-effects it performs (it doesn't return values)
const { checkAuth } = useAuth();

useEffect(() => {
  checkAuth();
}, [checkAuth]);

// Initialize state for auth values
const [isAuthenticated, setIsAuthenticated] = useState(false);
const [isLoading, setIsLoading] = useState(true);
const [isInitialized, setIsInitialized] = useState(false);

// Sync auth store values to React state (client-only)
useEffect(() => {
  const store = useAuthStore.getState();
  setIsAuthenticated(store.isAuthenticated);
  setIsLoading(store.isLoading);
  setIsInitialized(store.isInitialized);

// Subscribe to store changes
  const unsubscribe = useAuthStore.subscribe((state) => {
    setIsAuthenticated(state.isAuthenticated);
    setIsLoading(state.isLoading);
    setIsInitialized(state.isInitialized);
  });

  return unsubscribe;
}, []);

// Redirect unauthenticated users
useEffect(() => {
if (
isInitialized &&
!isLoading &&
!isAuthenticated
) {
router.replace('/login');
}
}, [isInitialized, isLoading, isAuthenticated, router]);

// Initial auth check
if (!isInitialized || isLoading) {
return (<div className="flex h-screen items-center justify-center"> <Loader2 className="h-8 w-8 animate-spin text-primary" /> </div>);

}

// Redirecting
if (!isAuthenticated) {
return (<div className="flex h-screen items-center justify-center"> <Loader2 className="h-8 w-8 animate-spin text-primary" /> </div>);

}

return (<DashboardShell>{children}</DashboardShell>);
}