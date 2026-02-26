export function Skeleton({ className = "h-4 w-full" }) {
  return <div className={`animate-pulse rounded bg-brandGreen/10 ${className}`.trim()} />;
}
