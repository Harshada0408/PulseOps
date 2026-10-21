'use client';

import { ReactNode, useEffect } from 'react';

export function AppProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // This ensures we're running on the client
  }, []);

  return <>{children}</>;
}
