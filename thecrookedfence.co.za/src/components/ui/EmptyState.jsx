export function EmptyState({ title, description, actions }) {
  return (
    <div className="rounded-2xl border border-dashed border-brandGreen/25 bg-white/70 p-5 text-center text-brandGreen">
      {title ? <h3 className="text-lg font-semibold">{title}</h3> : null}
      {description ? <p className="mt-2 text-sm text-brandGreen/70">{description}</p> : null}
      {actions ? <div className="mt-4 flex justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
