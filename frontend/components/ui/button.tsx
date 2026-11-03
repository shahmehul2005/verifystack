import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * One shape: a flat fill, a 6px corner, no gradient and no shadow. The public
 * site sets `rounded-none` on top of this for its square buttons.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 active:translate-y-px [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-teal-600 text-white hover:bg-teal-700",
        secondary: "border border-mist-900/15 bg-mist-50 text-mist-800 hover:border-mist-900/30 hover:bg-mist-200",
        subtle: "bg-teal-600/10 text-teal-900 hover:bg-teal-600/15",
        ghost: "text-mist-700 hover:bg-mist-900/5 hover:text-mist-900",
        danger: "bg-red-700 text-white hover:bg-red-800",
        link: "h-auto px-0 text-teal-700 underline-offset-4 hover:text-teal-800 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-4",
        lg: "h-11 px-5 text-[15px]",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0" }],
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
