'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/common/ui';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const has = typeof window !== 'undefined' && !!localStorage.getItem('access_token');
    router.replace(has ? '/dashboard' : '/login');
  }, [router]);
  return <Spinner />;
}
