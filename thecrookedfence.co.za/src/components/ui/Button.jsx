export function Button({
  type = "button",
  variant = "primary",
  className = "",
  disabled = false,
  children,
  ...props
}) {
  const base =
    "inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-2";
  const variants = {
    primary: "bg-brandGreen text-white shadow-sm hover:shadow-md focus:ring-brandGreen disabled:opacity-60",
    secondary: "border border-brandGreen/30 bg-white text-brandGreen hover:bg-brandBeige/50 focus:ring-brandGreen",
    danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50 focus:ring-red-500",
    ghost: "bg-transparent text-brandGreen hover:bg-brandBeige/40 focus:ring-brandGreen",
  };

  return (
    <button
      type={type}
      disabled={disabled}
      className={`${base} ${variants[variant] || variants.primary} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
