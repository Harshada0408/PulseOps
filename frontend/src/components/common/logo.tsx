import { Activity } from 'lucide-react';
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Activity className="h-4.5 w-4.5" aria-hidden /></span>
      {!compact && <span className="text-base font-semibold tracking-tight">PulseOps</span>}
    </span>
  );
}
