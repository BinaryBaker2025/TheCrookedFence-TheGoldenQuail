export const OPERATIONS_TIMEZONE = "Africa/Johannesburg";
export const REMINDER_OFFSETS_MINUTES = [60, 1440, 4320];

export const TASK_STATUS_OPTIONS = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
];

export const TASK_PRIORITY_OPTIONS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "urgent", label: "Urgent" },
];

export const RECURRENCE_FREQ_OPTIONS = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
];

export const RECURRENCE_END_OPTIONS = [
  { id: "never", label: "Never" },
  { id: "until", label: "Until date" },
  { id: "count", label: "Occurrence count" },
];

export const WEEKDAY_OPTIONS = [
  { id: "MO", label: "Mon" },
  { id: "TU", label: "Tue" },
  { id: "WE", label: "Wed" },
  { id: "TH", label: "Thu" },
  { id: "FR", label: "Fri" },
  { id: "SA", label: "Sat" },
  { id: "SU", label: "Sun" },
];

export const CATEGORY_COLORS = [
  "#0f766e",
  "#1d4ed8",
  "#7c3aed",
  "#be123c",
  "#b45309",
  "#166534",
  "#0369a1",
  "#4338ca",
];

export const REMINDER_LABELS = {
  60: "1 hour before",
  1440: "1 day before",
  4320: "3 days before",
};

export const createDefaultRecurrence = () => ({
  freq: "weekly",
  interval: 1,
  byWeekday: [],
  byMonthDay: null,
  endType: "never",
  untilAt: null,
  count: null,
  timezone: OPERATIONS_TIMEZONE,
});

export const createTaskDraft = () => ({
  title: "",
  notes: "",
  statusDefault: "todo",
  priority: "medium",
  categoryId: "",
  dueAt: "",
  isRecurring: false,
  recurrence: createDefaultRecurrence(),
  assigneeIds: [],
});

export const createEventDraft = () => ({
  title: "",
  notes: "",
  location: "",
  allDay: false,
  startAt: "",
  endAt: "",
  categoryId: "",
  assignmentMode: "optional",
  assigneeIds: [],
  isRecurring: false,
  recurrence: createDefaultRecurrence(),
});

export const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : new Date(parsed);
};

export const toDateTimeLocalValue = (value) => {
  const date = toDate(value);
  if (!date) return "";
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - tzOffsetMs);
  return local.toISOString().slice(0, 16);
};

export const toDateInputValue = (value) => {
  const date = toDate(value);
  if (!date) return "";
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - tzOffsetMs);
  return local.toISOString().slice(0, 10);
};

export const fromDateTimeLocalValue = (value) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
};

export const fromDateInputValue = (value) => {
  if (!value) return null;
  const parsed = Date.parse(`${value}T00:00:00`);
  return Number.isNaN(parsed) ? null : new Date(parsed);
};

export const formatDateTime = (value) => {
  const date = toDate(value);
  if (!date) return "-";
  return date.toLocaleString();
};

export const formatDate = (value) => {
  const date = toDate(value);
  if (!date) return "-";
  return date.toLocaleDateString();
};

export const formatRelativeDue = (value) => {
  const date = toDate(value);
  if (!date) return "No due date";
  const deltaMs = date.getTime() - Date.now();
  const deltaMin = Math.round(deltaMs / 60000);
  if (deltaMin < 0) return `${Math.abs(deltaMin)} min overdue`;
  if (deltaMin < 60) return `${deltaMin} min remaining`;
  const hours = Math.round(deltaMin / 60);
  if (hours < 24) return `${hours} hr remaining`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} remaining`;
};

export const normalizeAssigneePayload = (selectedIds = [], users = []) => {
  const dedupedIds = Array.from(new Set(selectedIds.filter(Boolean)));
  const emailLookup = new Map(
    users.map((entry) => [entry.id, String(entry.email || "").trim()])
  );
  const assigneeEmails = dedupedIds
    .map((id) => emailLookup.get(id) || "")
    .filter(Boolean);

  return { assigneeIds: dedupedIds, assigneeEmails };
};

export const normalizeReminderState = (state) => ({
  email_60: Boolean(state?.email_60),
  app_60: Boolean(state?.app_60),
  email_1440: Boolean(state?.email_1440),
  app_1440: Boolean(state?.app_1440),
  email_4320: Boolean(state?.email_4320),
  app_4320: Boolean(state?.app_4320),
});

export const buildRecurringLabel = (recurrence) => {
  if (!recurrence?.freq) return "Custom recurrence";
  const interval = Number(recurrence.interval || 1);
  const every =
    interval <= 1 ? "Every" : `Every ${interval}`;
  return `${every} ${recurrence.freq}`;
};

export const buildOccurrenceEventTitle = (occurrence) => {
  const base = String(occurrence?.title || "").trim() || "Event";
  const location = String(occurrence?.location || "").trim();
  return location ? `${base} - ${location}` : base;
};

export const isReminderDueSoon = (value, minutes = 7 * 24 * 60) => {
  const date = toDate(value);
  if (!date) return false;
  const deltaMs = date.getTime() - Date.now();
  return deltaMs >= 0 && deltaMs <= minutes * 60000;
};

