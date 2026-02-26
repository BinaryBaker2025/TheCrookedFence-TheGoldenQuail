import {
  RECURRENCE_END_OPTIONS,
  RECURRENCE_FREQ_OPTIONS,
  WEEKDAY_OPTIONS,
} from "../../lib/operations.js";

const inputClass =
  "w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30";

export function RecurrenceFields({
  recurrence,
  onChange,
  dateOnly = false,
  disabled = false,
}) {
  const update = (patch) => onChange({ ...recurrence, ...patch });

  return (
    <div className="space-y-3 rounded-xl border border-brandGreen/15 bg-brandBeige/30 p-3">
      <div className="grid gap-2 md:grid-cols-3">
        <label className="space-y-1 text-sm text-brandGreen/80">
          <span className="font-semibold">Frequency</span>
          <select
            value={recurrence.freq}
            onChange={(event) => update({ freq: event.target.value })}
            className={inputClass}
            disabled={disabled}
          >
            {RECURRENCE_FREQ_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm text-brandGreen/80">
          <span className="font-semibold">Interval</span>
          <input
            type="number"
            min="1"
            value={recurrence.interval ?? 1}
            onChange={(event) =>
              update({
                interval: Math.max(1, Number(event.target.value || 1)),
              })
            }
            className={inputClass}
            disabled={disabled}
          />
        </label>
        <label className="space-y-1 text-sm text-brandGreen/80">
          <span className="font-semibold">Ends</span>
          <select
            value={recurrence.endType}
            onChange={(event) => update({ endType: event.target.value })}
            className={inputClass}
            disabled={disabled}
          >
            {RECURRENCE_END_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {recurrence.freq === "weekly" ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
            Weekdays
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {WEEKDAY_OPTIONS.map((day) => {
              const selected = recurrence.byWeekday?.includes(day.id);
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() =>
                    update({
                      byWeekday: selected
                        ? (recurrence.byWeekday || []).filter(
                            (entry) => entry !== day.id
                          )
                        : [...(recurrence.byWeekday || []), day.id],
                    })
                  }
                  disabled={disabled}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    selected
                      ? "border-brandGreen bg-brandGreen text-white"
                      : "border-brandGreen/30 text-brandGreen hover:bg-brandBeige"
                  }`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {recurrence.freq === "monthly" ? (
        <label className="space-y-1 text-sm text-brandGreen/80">
          <span className="font-semibold">Day of month</span>
          <input
            type="number"
            min="1"
            max="31"
            value={recurrence.byMonthDay ?? ""}
            onChange={(event) =>
              update({
                byMonthDay:
                  event.target.value === ""
                    ? null
                    : Math.min(31, Math.max(1, Number(event.target.value))),
              })
            }
            className={inputClass}
            disabled={disabled}
          />
        </label>
      ) : null}

      {recurrence.endType === "until" ? (
        <label className="space-y-1 text-sm text-brandGreen/80">
          <span className="font-semibold">Until</span>
          <input
            type={dateOnly ? "date" : "datetime-local"}
            value={recurrence.untilAt || ""}
            onChange={(event) => update({ untilAt: event.target.value })}
            className={inputClass}
            disabled={disabled}
          />
        </label>
      ) : null}

      {recurrence.endType === "count" ? (
        <label className="space-y-1 text-sm text-brandGreen/80">
          <span className="font-semibold">Occurrences</span>
          <input
            type="number"
            min="1"
            max="365"
            value={recurrence.count ?? ""}
            onChange={(event) =>
              update({
                count:
                  event.target.value === ""
                    ? null
                    : Math.min(365, Math.max(1, Number(event.target.value))),
              })
            }
            className={inputClass}
            disabled={disabled}
          />
        </label>
      ) : null}
    </div>
  );
}

