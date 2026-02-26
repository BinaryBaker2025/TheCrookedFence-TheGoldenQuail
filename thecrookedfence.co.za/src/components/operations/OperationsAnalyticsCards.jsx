export function OperationsAnalyticsCards({ cards = [] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.id}
          className="rounded-2xl border border-brandGreen/10 bg-white/80 p-4 shadow-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brandGreen/70">
            {card.label}
          </p>
          <p className="mt-2 text-2xl font-bold text-brandGreen">{card.value}</p>
          {card.hint ? (
            <p className="mt-1 text-xs text-brandGreen/65">{card.hint}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

