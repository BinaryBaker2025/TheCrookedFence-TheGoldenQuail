export function Banner({ message, tone = "info" }) {
  if (!message) return null;
  const tones = {
    info: "border-brandGreen/20 bg-white text-brandGreen",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone] || tones.info}`.trim()}>
      {message}
    </div>
  );
}
