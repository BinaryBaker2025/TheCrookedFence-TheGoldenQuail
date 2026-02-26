import { RecurrenceFields } from "./RecurrenceFields.jsx";

const inputClass =
  "w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30 disabled:cursor-not-allowed disabled:opacity-65";

function AssigneeEditor({
  users = [],
  selectedIds = [],
  disabled = false,
  onChange,
}) {
  const selected = Array.isArray(selectedIds) ? selectedIds : [];
  const availableUsers = users.filter(
    (account) => account?.id && !selected.includes(account.id)
  );
  const selectedUsers = selected.map((id) => {
    const account = users.find((entry) => entry.id === id);
    return {
      id,
      label: account?.email || id,
    };
  });

  const addAssignee = (assigneeId) => {
    if (!assigneeId || selected.includes(assigneeId)) return;
    onChange([...selected, assigneeId]);
  };

  const removeAssignee = (assigneeId) => {
    onChange(selected.filter((id) => id !== assigneeId));
  };

  return (
    <div className="space-y-2">
      <select
        className={inputClass}
        value=""
        disabled={disabled}
        onChange={(event) => addAssignee(event.target.value)}
      >
        <option value="">Add assignee</option>
        {availableUsers.map((account) => (
          <option key={account.id} value={account.id}>
            {account.email || account.id}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        {selectedUsers.length === 0 ? (
          <p className="text-xs text-brandGreen/70">No assignees selected.</p>
        ) : (
          selectedUsers.map((account) => (
            <span
              key={account.id}
              className="inline-flex items-center gap-2 rounded-full border border-brandGreen/25 bg-brandBeige/30 px-3 py-1 text-xs font-semibold text-brandGreen"
            >
              <span>{account.label}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeAssignee(account.id)}
                className="rounded-full border border-brandGreen/30 px-1 text-[10px] leading-none disabled:opacity-50"
                aria-label={`Remove ${account.label}`}
              >
                x
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brandGreen/70">
        {label}
      </p>
      <p className="text-sm text-brandGreen">{value || "-"}</p>
    </div>
  );
}

export function OperationsCalendarItemPanel({
  isOpen,
  draft,
  users = [],
  taskCategories = [],
  eventCategories = [],
  taskStatusOptions = [],
  taskPriorityOptions = [],
  isAdmin = false,
  isWorker = false,
  pendingFiles = [],
  saving = false,
  deleting = false,
  error = "",
  message = "",
  onClose,
  onChangeDraft,
  onPendingFilesChange,
  onSave,
  onDelete,
  onRemoveAttachment,
}) {
  if (!isOpen || !draft) return null;

  const isTask = draft.kind === "task";
  const isEvent = draft.kind === "event";
  const workerTaskEditor = isWorker && isTask && !isAdmin;
  const canSave = isAdmin || workerTaskEditor;
  const canDelete = isAdmin;
  const recurrenceDateOnly = isEvent && Boolean(draft.seriesAllDay ?? draft.allDay);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45">
      <div className="h-full w-full max-w-xl overflow-y-auto border-l border-brandGreen/10 bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-brandGreen/10 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brandGreen/70">
              {isTask ? "Calendar task" : "Calendar event"}
            </p>
            <h2 className="text-xl font-bold text-brandGreen">
              {draft.title || (isTask ? "Task" : "Event")}
            </h2>
            <p className="text-xs text-brandGreen/70">
              {draft.isRecurringOccurrence
                ? "Recurring occurrence"
                : "One-time item"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
          >
            Close
          </button>
        </div>

        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        {message ? (
          <p className="mt-3 text-sm text-emerald-700">{message}</p>
        ) : null}

        <div className="mt-4 space-y-4">
          {workerTaskEditor ? (
            <div className="space-y-3">
              <ReadOnlyField label="Notes" value={draft.notes} />
              <ReadOnlyField label="Due" value={draft.dueAtDisplay} />
              <ReadOnlyField label="Assignees" value={draft.assigneeLabel} />
              <label className="space-y-1 text-sm text-brandGreen/80">
                <span className="font-semibold">Status</span>
                <select
                  className={inputClass}
                  value={draft.status || "todo"}
                  onChange={(event) =>
                    onChangeDraft({ status: event.target.value })
                  }
                >
                  {taskStatusOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm text-brandGreen/80">
                <span className="font-semibold">Progress note</span>
                <textarea
                  className={inputClass}
                  rows={3}
                  value={draft.progressNote || ""}
                  onChange={(event) =>
                    onChangeDraft({ progressNote: event.target.value })
                  }
                />
              </label>
            </div>
          ) : isAdmin ? (
            <>
              {isTask ? (
                <div className="space-y-3">
                  <input
                    className={inputClass}
                    placeholder="Title"
                    value={draft.title || ""}
                    onChange={(event) =>
                      onChangeDraft({ title: event.target.value })
                    }
                  />
                  <textarea
                    className={inputClass}
                    rows={3}
                    placeholder="Notes"
                    value={draft.notes || ""}
                    onChange={(event) =>
                      onChangeDraft({ notes: event.target.value })
                    }
                  />
                  <div className="grid gap-2 md:grid-cols-3">
                    <select
                      className={inputClass}
                      value={draft.status || "todo"}
                      onChange={(event) =>
                        onChangeDraft({ status: event.target.value })
                      }
                    >
                      {taskStatusOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className={inputClass}
                      value={draft.priority || "medium"}
                      onChange={(event) =>
                        onChangeDraft({ priority: event.target.value })
                      }
                    >
                      {taskPriorityOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className={inputClass}
                      value={draft.categoryId || ""}
                      onChange={(event) =>
                        onChangeDraft({ categoryId: event.target.value })
                      }
                    >
                      <option value="">No category</option>
                      {taskCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="datetime-local"
                    className={inputClass}
                    value={draft.dueAt || ""}
                    onChange={(event) =>
                      onChangeDraft({ dueAt: event.target.value })
                    }
                  />
                  <AssigneeEditor
                    users={users}
                    selectedIds={draft.assigneeIds || []}
                    onChange={(nextIds) => onChangeDraft({ assigneeIds: nextIds })}
                  />
                  <label className="space-y-1 text-sm text-brandGreen/80">
                    <span className="font-semibold">Progress note</span>
                    <textarea
                      className={inputClass}
                      rows={3}
                      value={draft.progressNote || ""}
                      onChange={(event) =>
                        onChangeDraft({ progressNote: event.target.value })
                      }
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    className={inputClass}
                    placeholder="Title"
                    value={draft.title || ""}
                    onChange={(event) =>
                      onChangeDraft({ title: event.target.value })
                    }
                  />
                  <textarea
                    className={inputClass}
                    rows={2}
                    placeholder="Notes"
                    value={draft.notes || ""}
                    onChange={(event) =>
                      onChangeDraft({ notes: event.target.value })
                    }
                  />
                  <input
                    className={inputClass}
                    placeholder="Location"
                    value={draft.location || ""}
                    onChange={(event) =>
                      onChangeDraft({ location: event.target.value })
                    }
                  />
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-brandGreen">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.allDay)}
                      onChange={(event) =>
                        onChangeDraft({
                          allDay: event.target.checked,
                          startAt: "",
                          endAt: "",
                        })
                      }
                    />
                    All day
                  </label>
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      type={draft.allDay ? "date" : "datetime-local"}
                      className={inputClass}
                      value={draft.startAt || ""}
                      onChange={(event) =>
                        onChangeDraft({ startAt: event.target.value })
                      }
                    />
                    <input
                      type={draft.allDay ? "date" : "datetime-local"}
                      className={inputClass}
                      value={draft.endAt || ""}
                      onChange={(event) =>
                        onChangeDraft({ endAt: event.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <select
                      className={inputClass}
                      value={draft.categoryId || ""}
                      onChange={(event) =>
                        onChangeDraft({ categoryId: event.target.value })
                      }
                    >
                      <option value="">No category</option>
                      {eventCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className={inputClass}
                      value={draft.assignmentMode || "optional"}
                      onChange={(event) =>
                        onChangeDraft({ assignmentMode: event.target.value })
                      }
                    >
                      <option value="optional">Assignees optional</option>
                      <option value="required">Assignees required</option>
                    </select>
                  </div>
                  <AssigneeEditor
                    users={users}
                    selectedIds={draft.assigneeIds || []}
                    onChange={(nextIds) => onChangeDraft({ assigneeIds: nextIds })}
                  />
                </div>
              )}

              <div className="rounded-xl border border-brandGreen/15 bg-brandBeige/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-brandGreen">
                    Series recurrence
                  </p>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-brandGreen">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.seriesIsRecurring)}
                      onChange={(event) =>
                        onChangeDraft({ seriesIsRecurring: event.target.checked })
                      }
                    />
                    Recurring
                  </label>
                </div>
                {draft.isRecurringOccurrence ? (
                  <p className="mt-1 text-xs text-brandGreen/70">
                    Recurrence changes apply to the full series.
                  </p>
                ) : null}
                {draft.seriesIsRecurring ? (
                  <div className="mt-3">
                    <RecurrenceFields
                      recurrence={draft.seriesRecurrence}
                      onChange={(next) =>
                        onChangeDraft({ seriesRecurrence: next })
                      }
                      dateOnly={recurrenceDateOnly}
                    />
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-brandGreen/15 bg-brandBeige/20 p-3">
                <p className="text-sm font-semibold text-brandGreen">
                  Attachments (series)
                </p>
                <div className="mt-2 space-y-2">
                  {(draft.attachments || []).length === 0 ? (
                    <p className="text-xs text-brandGreen/70">
                      No attachments.
                    </p>
                  ) : (
                    (draft.attachments || []).map((attachment, index) => (
                      <div
                        key={`${attachment.path || attachment.url || "att"}-${index}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-brandGreen/15 bg-white px-3 py-2"
                      >
                        <a
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-xs font-semibold text-brandGreen underline"
                        >
                          {attachment.name || "Attachment"}
                        </a>
                        <button
                          type="button"
                          onClick={() => onRemoveAttachment(index)}
                          className="rounded-full border border-red-300 px-2 py-0.5 text-[10px] font-semibold text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className={`${inputClass} mt-3`}
                  onChange={(event) =>
                    onPendingFilesChange(Array.from(event.target.files || []))
                  }
                />
                {pendingFiles.length > 0 ? (
                  <p className="mt-2 text-xs text-brandGreen/70">
                    Pending uploads:{" "}
                    {pendingFiles.map((file) => file.name).join(", ")}
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <ReadOnlyField label="Notes" value={draft.notes} />
              {isEvent ? (
                <>
                  <ReadOnlyField label="Location" value={draft.location} />
                  <ReadOnlyField label="Start" value={draft.startAtDisplay} />
                  <ReadOnlyField label="End" value={draft.endAtDisplay} />
                </>
              ) : null}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-brandGreen/10 pt-3">
          <div>
            {canDelete ? (
              <button
                type="button"
                disabled={saving || deleting}
                onClick={onDelete}
                className="rounded-full border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-60"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
            >
              Close
            </button>
            {canSave ? (
              <button
                type="button"
                disabled={saving || deleting}
                onClick={onSave}
                className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
