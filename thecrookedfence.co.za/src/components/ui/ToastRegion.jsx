export function ToastRegion({ toasts = [] }) {
  if (!Array.isArray(toasts) || toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex w-[min(420px,calc(100%-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id || toast.message}
          className="rounded-lg border border-brandGreen/20 bg-white px-4 py-3 text-sm text-brandGreen shadow-lg"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
