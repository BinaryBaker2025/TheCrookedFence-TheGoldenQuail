import { Button } from "./Button.jsx";

export function Dialog({ open, title, children, onClose, closeLabel = "Close" }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={title || "Dialog"}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 text-brandGreen shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {title ? <h3 className="text-xl font-bold">{title}</h3> : null}
        <div className="mt-2">{children}</div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
