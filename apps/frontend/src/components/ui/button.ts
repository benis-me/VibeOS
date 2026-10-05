import { cva } from "class-variance-authority";

/** The native apps' one button: four variants, two compact sizes, one focus ring. */
export const buttonVariants = cva(
  "vibe-btn inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-accent aria-pressed:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-brand text-brand-foreground hover:bg-brand/90",
        outline: "border bg-card hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        destructive: "border bg-card text-destructive hover:bg-destructive-fill hover:text-white",
      },
      size: { default: "h-8 px-3", sm: "h-7 px-2", icon: "size-8" },
    },
    defaultVariants: { variant: "outline", size: "default" },
  },
);
