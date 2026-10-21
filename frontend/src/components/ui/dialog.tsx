'use client';

import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export function Modal({ open, onOpenChange, title, description, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <D.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-xl focus:outline-none">
          <D.Title className="text-base font-semibold">{title}</D.Title>
          {description && <D.Description className="mt-1.5 text-sm text-muted-foreground">{description}</D.Description>}
          <div className="mt-5">{children}</div>
          <D.Close aria-label="Close" className="absolute right-4 top-4 rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
