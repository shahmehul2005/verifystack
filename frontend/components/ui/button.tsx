import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900",
  {
    variants: {
      variant: {
        primary: "bg-stone-900 text-stone-50 hover:bg-stone-800",
        secondary: "bg-white text-stone-900 ring-1 ring-stone-300 hover:bg-stone-50",
        ghost: "text-stone-700 hover:bg-stone-100",
        danger: "bg-red-800 text-white hover:bg-red-700",
        link: "text-stone-800 underline-offset-2 hover:underline",
      },
      size: {
        sm: "h-8 px-2.5 text-[12px]",
        md: "h-9 px-3.5",
        lg: "h-10 px-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
