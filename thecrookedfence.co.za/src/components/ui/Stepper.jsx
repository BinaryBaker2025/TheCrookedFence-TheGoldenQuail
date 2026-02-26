export function Stepper({ steps = [], currentIndex = 0, onStepClick }) {
  if (!Array.isArray(steps) || steps.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {steps.map((step, index) => {
          const isActive = index === currentIndex;
          const isDone = index < currentIndex;
          return (
            <button
              key={step.id || step.label || index}
              type="button"
              onClick={() => onStepClick?.(index)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold whitespace-nowrap ${
                isActive
                  ? "border-brandGreen bg-brandGreen text-white"
                  : isDone
                  ? "border-brandGreen/30 bg-white text-brandGreen"
                  : "border-brandGreen/20 bg-white/70 text-brandGreen/70"
              }`}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px]">
                {index + 1}
              </span>
              <span>{step.label || `Step ${index + 1}`}</span>
            </button>
          );
        })}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-brandGreen/10">
        <div
          className="h-full rounded-full bg-brandGreen transition-all"
          style={{ width: `${((currentIndex + 1) / steps.length) * 100}%` }}
        />
      </div>
    </div>
  );
}
