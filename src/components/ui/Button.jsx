import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Brand button in the shadcn idiom (cva variants + Slot). The existing call
 * sites keep working: `variant` still accepts primary/ghost/subtle, `size`
 * accepts sm/md, and `as` renders a different element (e.g. as={Link}). New
 * variants (secondary, destructive, icon) are available too.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-sans font-semibold outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white shadow-xs hover:bg-accent-dark",
        secondary: "bg-accent-l text-accent hover:bg-accent-l/70",
        ghost: "border border-line bg-white text-ink shadow-xs hover:border-accent/40 hover:bg-bg",
        subtle: "text-accent hover:bg-accent-l/60",
        destructive: "bg-destructive text-white shadow-xs hover:brightness-95",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 rounded-md px-3 text-xs",
        md: "h-9 px-4 text-[13px]",
        lg: "h-10 px-5 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({ as, asChild = false, variant, size, className, ...props }) {
  const Comp = asChild ? Slot : as || "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
