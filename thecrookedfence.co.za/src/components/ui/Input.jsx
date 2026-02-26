export function Input({ className = "", ...props }) {
  return (
    <input
      className={`w-full rounded-lg border border-brandGreen/25 bg-white px-4 py-3 text-brandGreen placeholder:text-brandGreen/50 focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 ${className}`.trim()}
      {...props}
    />
  );
}
