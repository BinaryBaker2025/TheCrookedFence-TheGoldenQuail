export function Select({ className = "", children, ...props }) {
  return (
    <select
      className={`w-full rounded-lg border border-brandGreen/25 bg-white px-4 py-3 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 ${className}`.trim()}
      {...props}
    >
      {children}
    </select>
  );
}
