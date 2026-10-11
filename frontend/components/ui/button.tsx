import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color,border-color,box-shadow,transform] duration-200 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 active:scale-[0.985] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-linear-to-b from-teal-600 to-teal-800 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_1px_2px_rgb(12_22_21/0.28),0_6px_14px_-6px_rgb(15_118_110/0.55)] hover:from-teal-600 hover:to-teal-900",
        secondary:
          "border border-mist-900/10 bg-white/70 text-mist-800 shadow-[inset_0_1px_0_rgb(255_255_255/0.9),0_1px_2px_rgb(12_22_21/0.06)] backdrop-blur hover:border-mist-900/20 hover:bg-white",
        subtle: "bg-teal-600/10 text-teal-900 hover:bg-teal-600/15",
        ghost: "text-mist-700 hover:bg-mist-900/5 hover:text-mist-900",
        danger:
          "bg-linear-to-b from-red-600 to-red-800 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(12_22_21/0.28)] hover:to-red-900",
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
