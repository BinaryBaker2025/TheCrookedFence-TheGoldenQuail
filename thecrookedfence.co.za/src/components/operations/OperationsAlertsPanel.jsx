import { formatDateTime } from "../../lib/operations.js";

export function OperationsAlertsPanel({
  isOpen,
  notifications = [],
  unreadCount = 0,
  onClose,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/45">
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-brandGreen/10 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brandGreen/70">
              Alerts
            </p>
            <h2 className="text-xl font-bold text-brandGreen">
              Reminders ({unreadCount} unread)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
          >
            Close
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {notifications.length === 0 ? (
            <div className="rounded-xl border border-dashed border-brandGreen/30 bg-brandBeige/30 px-4 py-5 text-sm text-brandGreen/70">
              No reminders yet.
            </div>
          ) : (
            notifications.map((item) => (
              <div
                key={item.id}
                className={`rounded-xl border px-3 py-3 ${
                  item.read
                    ? "border-brandGreen/10 bg-white"
                    : "border-amber-300 bg-amber-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-brandGreen">
                    {item.title || "Reminder"}
                  </p>
                  {!item.read ? (
                    <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      Unread
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-brandGreen/80">
                  {item.message || "-"}
                </p>
                <p className="mt-2 text-xs text-brandGreen/65">
                  {formatDateTime(item.triggerAt || item.createdAt)}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

