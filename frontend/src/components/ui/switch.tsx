import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'inline-flex h-4 w-9 items-center shrink-0 cursor-pointer gap-1 rounded-full border-2 border-transparent bg-muted',
      className,
    )}
    {...props}
  />
));
Switch.displayName = SwitchPrimitive.Root.displayName;

const SwitchThumb = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Thumb>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Thumb>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Thumb
    ref={ref}
    className={cn(
      'block h-3 w-3 rounded-full bg-background ring-0 transition-transform',
      'data-[state=checked]:translate-x-4',
      className,
    )}
    {...props}
  />
));
SwitchThumb.displayName = SwitchPrimitive.Thumb.displayName;

export { Switch, SwitchThumb };