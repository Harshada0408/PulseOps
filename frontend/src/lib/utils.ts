import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'up': return 'text-status-up bg-status-up/10';
    case 'down': return 'text-status-down bg-status-down/10';
    case 'degraded': return 'text-status-degraded bg-status-degraded/10';
    case 'paused': return 'text-status-paused bg-status-paused/10';
    default: return 'text-gray-500 bg-gray-500/10';
  }
}

export function getStatusDot(status: string): string {
  switch (status) {
    case 'up': return 'bg-status-up';
    case 'down': return 'bg-status-down';
    case 'degraded': return 'bg-status-degraded';
    default: return 'bg-gray-400';
  }
}
