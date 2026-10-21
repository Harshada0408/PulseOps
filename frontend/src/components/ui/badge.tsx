import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary/15 text-primary hover:bg-primary/25',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive/15 text-destructive hover:bg-destructive/25',
        outline: 'text-foreground border-border',
        success:
          'border-transparent bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 hover:bg-emerald-500/25',
        warning:
          'border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25',
        error:
          'border-transparent bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            variant === 'success' && 'bg-current',
            variant === 'error' && 'bg-current',
            variant === 'warning' && 'bg-current',
            !variant && 'bg-current'
          )}
        />
      )}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
