import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] border text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--acid)] disabled:pointer-events-none disabled:opacity-30",
  {
    variants: {
      variant: {
        default: "border-[var(--line)] bg-[var(--panel-2)] text-[var(--paper)] hover:border-[var(--acid)] hover:text-[var(--acid)]",
        accent: "border-[var(--acid)] bg-[var(--acid)] text-[var(--ink)] hover:bg-[#d1ff7d]",
        ghost: "border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--paper)]",
        outline: "border-[var(--line)] bg-transparent text-[var(--paper)] hover:border-[var(--acid)] hover:text-[var(--acid)]"
      },
      size: {
        default: "px-4 py-2",
        sm: "min-h-8 px-3 py-1",
        icon: "size-11 min-h-11 p-0"
      }
    },
    defaultVariants: { variant: "default", size: "default" }
  }
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
