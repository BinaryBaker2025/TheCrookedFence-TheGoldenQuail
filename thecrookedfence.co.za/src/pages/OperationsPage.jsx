import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import rrulePlugin from "@fullcalendar/rrule";
import { db, functions, storage } from "../lib/firebase.js";
import { useAuthRole } from "../lib/useAuthRole.js";
import {
  CATEGORY_COLORS,
  OPERATIONS_TIMEZONE,
  REMINDER_OFFSETS_MINUTES,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  buildOccurrenceEventTitle,
  createDefaultRecurrence,
  createEventDraft,
  createTaskDraft,
  normalizeAssigneePayload,
  normalizeReminderState,
  toDate,
  toDateInputValue,
  toDateTimeLocalValue,
} from "../lib/operations.js";
import { OperationsAnalyticsCards } from "../components/operations/OperationsAnalyticsCards.jsx";
import { OperationsAlertsPanel } from "../components/operations/OperationsAlertsPanel.jsx";
import { OperationsCalendarItemPanel } from "../components/operations/OperationsCalendarItemPanel.jsx";
import { RecurrenceFields } from "../components/operations/RecurrenceFields.jsx";

const inputClass =
  "w-full rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-brandGreen focus:border-brandGreen focus:outline-none focus:ring-2 focus:ring-brandGreen/30";
const panelClass =
  "rounded-2xl border border-brandGreen/10 bg-white/80 p-4 shadow-sm";
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const TASK_STATUS_COLORS = {
  todo: "#0f766e",
  doing: "#1d4ed8",
  done: "#6b7280",
};
const tintHex = (value, alpha = "24") =>
  typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value)
    ? `${value}${alpha}`
    : value;

const parseDraftDate = (value, allDay) => {
  if (!value) return null;
  return allDay ? new Date(`${value}T00:00:00`) : new Date(value);
};

const safeFileName = (value) =>
  String(value || "attachment")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "_");

const toDateMillis = (value) => {
  const date = toDate(value);
  return date ? date.getTime() : 0;
};

const parseOccurrenceKeyMillis = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isNaN(parsed) ? 0 : parsed;
};

const sortEventTemplates = (entries = []) =>
  [...entries].sort((left, right) => {
    const leftTime =
      toDateMillis(left.updatedAt) ||
      toDateMillis(left.createdAt);
    const rightTime =
      toDateMillis(right.updatedAt) ||
      toDateMillis(right.createdAt);
    if (rightTime !== leftTime) return rightTime - leftTime;
    return String(left.title || "").localeCompare(String(right.title || ""));
  });

const sortEventOccurrences = (entries = []) =>
  [...entries].sort((left, right) => {
    const leftTime =
      toDateMillis(left.startAt) ||
      parseOccurrenceKeyMillis(left.occurrenceKey);
    const rightTime =
      toDateMillis(right.startAt) ||
      parseOccurrenceKeyMillis(right.occurrenceKey);
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left.title || "").localeCompare(String(right.title || ""));
  });

const normalizeAttachmentArray = (value) =>
  Array.isArray(value) ? value.filter((entry) => entry && entry.url) : [];

const formatDateTimeDisplay = (value) => {
  const date = toDate(value);
  return date ? date.toLocaleString() : "-";
};

function OperationsDialog({
  isOpen,
  title,
  onClose,
  children,
  maxWidthClass = "max-w-3xl",
}) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`mt-8 w-full ${maxWidthClass} rounded-2xl border border-brandGreen/15 bg-white p-4 shadow-2xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-brandGreen/10 pb-3">
          <h2 className="text-lg font-bold text-brandGreen">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen"
          >
            Close
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

function IconBase({ className = "h-4 w-4", children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function IconBack(props) {
  return (
    <IconBase {...props}>
      <path d="M15 18l-6-6 6-6" />
    </IconBase>
  );
}

function IconBell(props) {
  return (
    <IconBase {...props}>
      <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
      <path d="M9 17a3 3 0 0 0 6 0" />
    </IconBase>
  );
}

function IconTask(props) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 12l2.5 2.5L16 9" />
    </IconBase>
  );
}

function IconCalendar(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </IconBase>
  );
}

function IconTag(props) {
  return (
    <IconBase {...props}>
      <path d="M20 10V5h-5L4 16l4 4L20 10z" />
      <circle cx="16.5" cy="7.5" r="1" />
    </IconBase>
  );
}

function IconPlus(props) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  );
}

function IconEdit(props) {
  return (
    <IconBase {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
    </IconBase>
  );
}

function IconTrash(props) {
  return (
    <IconBase {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </IconBase>
  );
}

function AssigneeDropdown({
  users = [],
  selectedIds = [],
  onChange,
  placeholder = "Assign person",
  compact = false,
}) {
  const selected = Array.isArray(selectedIds) ? selectedIds : [];
  const availableUsers = users.filter(
    (account) => account?.id && !selected.includes(account.id)
  );
  const selectedUsers = selected.map(
    (id) => users.find((account) => account.id === id) || { id, email: id }
  );

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
        onChange={(event) => addAssignee(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {availableUsers.map((account) => (
          <option key={account.id} value={account.id}>
            {account.email || account.id}
          </option>
        ))}
      </select>
      {!compact ? (
        <div className="flex flex-wrap gap-2">
          {selectedUsers.length === 0 ? (
            <p className="text-xs text-brandGreen/70">No assignees selected.</p>
          ) : (
            selectedUsers.map((account) => (
              <span
                key={account.id}
                className="inline-flex items-center gap-2 rounded-full border border-brandGreen/25 bg-brandBeige/30 px-3 py-1 text-xs font-semibold text-brandGreen"
              >
                <span>{account.email || account.id}</span>
                <button
                  type="button"
                  onClick={() => removeAssignee(account.id)}
                  className="rounded-full border border-brandGreen/30 px-1 text-[10px] leading-none"
                  aria-label={`Remove ${account.email || account.id}`}
                >
                  x
                </button>
              </span>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function OperationsPage() {
  const { user, role, loading, setRole } = useAuthRole();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = role === "admin" || role === "super_admin";
  const isWorker = role === "worker";
  const isStaff = isAdmin || isWorker;

  const [activeTab, setActiveTab] = useState("events");
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [taskCategories, setTaskCategories] = useState([]);
  const [eventCategories, setEventCategories] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [taskOccurrences, setTaskOccurrences] = useState([]);
  const [eventOccurrences, setEventOccurrences] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [adminRemindersCount, setAdminRemindersCount] = useState(0);

  const [taskDraft, setTaskDraft] = useState(createTaskDraft());
  const [eventDraft, setEventDraft] = useState(createEventDraft());
  const [taskFiles, setTaskFiles] = useState([]);
  const [eventFiles, setEventFiles] = useState([]);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingEventId, setEditingEventId] = useState(null);
  const [taskMessage, setTaskMessage] = useState("");
  const [eventMessage, setEventMessage] = useState("");
  const [taskError, setTaskError] = useState("");
  const [eventError, setEventError] = useState("");
  const [taskCategoryDraft, setTaskCategoryDraft] = useState({
    name: "",
    color: CATEGORY_COLORS[0],
  });
  const [eventCategoryDraft, setEventCategoryDraft] = useState({
    name: "",
    color: CATEGORY_COLORS[1],
  });
  const [taskStatusFilter, setTaskStatusFilter] = useState("all");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskPriorityFilter, setTaskPriorityFilter] = useState("all");
  const [taskCategoryFilter, setTaskCategoryFilter] = useState("all");
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState("all");
  const [taskDueWindowFilter, setTaskDueWindowFilter] = useState("all");
  const [taskHideCompleted, setTaskHideCompleted] = useState(false);
  const [eventSearch, setEventSearch] = useState("");
  const [eventCategoryFilter, setEventCategoryFilter] = useState("all");
  const [eventAssigneeFilter, setEventAssigneeFilter] = useState("all");
  const [eventShowPast, setEventShowPast] = useState(true);
  const [eventQueryError, setEventQueryError] = useState("");
  const [eventTemplateQueryError, setEventTemplateQueryError] = useState("");
  const [taskNoteEdits, setTaskNoteEdits] = useState({});
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [taskCategoryDialogOpen, setTaskCategoryDialogOpen] = useState(false);
  const [eventCategoryDialogOpen, setEventCategoryDialogOpen] = useState(false);
  const [calendarPanelOpen, setCalendarPanelOpen] = useState(false);
  const [calendarSelection, setCalendarSelection] = useState(null);
  const [calendarPanelDraft, setCalendarPanelDraft] = useState(null);
  const [calendarPanelFiles, setCalendarPanelFiles] = useState([]);
  const [calendarPanelRemovedAttachmentPaths, setCalendarPanelRemovedAttachmentPaths] = useState([]);
  const [calendarPanelError, setCalendarPanelError] = useState("");
  const [calendarPanelMessage, setCalendarPanelMessage] = useState("");
  const [calendarPanelSaving, setCalendarPanelSaving] = useState(false);
  const [calendarPanelDeleting, setCalendarPanelDeleting] = useState(false);
  const [claimsReady, setClaimsReady] = useState(false);

  useEffect(() => {
    if (!user) {
      setClaimsReady(false);
      return;
    }
    let active = true;
    setClaimsReady(false);
    const ensureProfile = httpsCallable(functions, "ensureCurrentUserProfile");
    ensureProfile()
      .then(() => user.getIdTokenResult(true))
      .then((tokenResult) => {
        if (!active) return;
        const nextRole = tokenResult?.claims?.role ?? null;
        if (nextRole) setRole(nextRole);
        setClaimsReady(true);
      })
      .catch((err) => {
        console.error("ensureCurrentUserProfile error", err);
        if (active) setClaimsReady(true);
      });
    return () => {
      active = false;
    };
  }, [user, setRole]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setAlertsOpen(params.get("panel") === "alerts");
  }, [location.search]);

  useEffect(() => {
    if (!user || !claimsReady || !isStaff) return undefined;
    setEventQueryError("");
    setEventTemplateQueryError("");
    let unsubTaskCategories = () => {};
    let unsubEventCategories = () => {};
    if (isAdmin) {
      unsubTaskCategories = onSnapshot(
        query(collection(db, "operationsTaskCategories"), orderBy("name", "asc")),
        (snapshot) =>
          setTaskCategories(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))),
        (error) => console.error("operationsTaskCategories listener error", error)
      );
      unsubEventCategories = onSnapshot(
        query(collection(db, "operationsEventCategories"), orderBy("name", "asc")),
        (snapshot) =>
          setEventCategories(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))),
        (error) => console.error("operationsEventCategories listener error", error)
      );
    } else {
      setTaskCategories([]);
      setEventCategories([]);
    }
    const taskOccQuery = isAdmin
      ? query(collection(db, "operationsTaskOccurrences"), orderBy("dueAt", "asc"))
      : query(collection(db, "operationsTaskOccurrences"), where("assigneeIds", "array-contains", user.uid), orderBy("dueAt", "asc"));
    const eventOccQuery = isAdmin
      ? query(collection(db, "operationsEventOccurrences"))
      : query(collection(db, "operationsEventOccurrences"), where("assigneeIds", "array-contains", user.uid));
    const unsubTaskOcc = onSnapshot(
      taskOccQuery,
      (snapshot) =>
        setTaskOccurrences(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data(), reminderState: normalizeReminderState(docSnap.data()?.reminderState) }))),
      (error) => console.error("operationsTaskOccurrences listener error", error)
    );
    const unsubEventOcc = onSnapshot(
      eventOccQuery,
      (snapshot) =>
        {
          const items = snapshot.docs.map((docSnap) => {
            const data = docSnap.data() || {};
            return {
              id: docSnap.id,
              ...data,
              isDeleted: data.isDeleted === true,
              reminderState: normalizeReminderState(data.reminderState),
            };
          });
          setEventOccurrences(sortEventOccurrences(items));
          setEventQueryError("");
        },
      (error) => {
        const message = `${error?.code || "unknown"}: ${error?.message || "Unable to load event occurrences."}`;
        setEventQueryError(message);
        console.error("operationsEventOccurrences listener error", error);
      }
    );
    const unsubNotifications = onSnapshot(
      query(collection(db, "operationsNotifications"), where("userId", "==", user.uid), orderBy("createdAt", "desc"), limit(200)),
      (snapshot) => setNotifications(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))),
      (error) => console.error("operationsNotifications listener error", error)
    );

    let unsubUsers = () => {};
    let unsubTasks = () => {};
    let unsubEvents = () => {};
    let unsubReminderCount = () => {};
    if (isAdmin) {
      unsubUsers = onSnapshot(
        query(collection(db, "users"), orderBy("email", "asc")),
        (snapshot) =>
          setUsers(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))),
        (error) => console.error("users listener error", error)
      );
      unsubTasks = onSnapshot(
        query(collection(db, "operationsTasks"), orderBy("updatedAt", "desc")),
        (snapshot) =>
          setTasks(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))),
        (error) => console.error("operationsTasks listener error", error)
      );
      unsubEvents = onSnapshot(
        query(collection(db, "operationsEvents")),
        (snapshot) => {
          const templates = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          setEvents(sortEventTemplates(templates));
          setEventTemplateQueryError("");
        },
        (error) => {
          const message = `${error?.code || "unknown"}: ${error?.message || "Unable to load event templates."}`;
          setEventTemplateQueryError(message);
          console.error("operationsEvents listener error", error);
        }
      );
      const since = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      unsubReminderCount = onSnapshot(
        query(collection(db, "operationsNotifications"), where("createdAt", ">=", since), orderBy("createdAt", "desc")),
        (snapshot) => setAdminRemindersCount(snapshot.size),
        (error) => console.error("operationsNotifications admin reminder listener error", error)
      );
    }
    if (!isAdmin) {
      setEvents([]);
      setEventTemplateQueryError("");
    }
    return () => {
      unsubTaskCategories();
      unsubEventCategories();
      unsubTaskOcc();
      unsubEventOcc();
      unsubNotifications();
      unsubUsers();
      unsubTasks();
      unsubEvents();
      unsubReminderCount();
    };
  }, [user, claimsReady, isStaff, isAdmin]);

  const unreadNotifications = useMemo(
    () => notifications.filter((entry) => !entry.read),
    [notifications]
  );

  useEffect(() => {
    if (!alertsOpen || unreadNotifications.length === 0) return;
    const batch = writeBatch(db);
    unreadNotifications.forEach((entry) => {
      batch.update(doc(db, "operationsNotifications", entry.id), {
        read: true,
        readAt: serverTimestamp(),
      });
    });
    batch.commit().catch((err) => console.error("mark read error", err));
  }, [alertsOpen, unreadNotifications]);

  const uploadAttachments = async (kind, parentId, files) => {
    const uploaded = [];
    for (const file of files) {
      if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
        throw new Error("Only image/pdf attachments are allowed.");
      }
      if (file.size > MAX_ATTACHMENT_SIZE) {
        throw new Error("Attachment exceeds 10MB.");
      }
      const path = `operations/${kind}/${parentId}/${Date.now()}_${safeFileName(file.name)}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, file, { contentType: file.type || undefined });
      uploaded.push({
        name: file.name,
        url: await getDownloadURL(fileRef),
        path,
        contentType: file.type || "",
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
      });
    }
    return uploaded;
  };

  const clearCalendarPanel = () => {
    setCalendarPanelOpen(false);
    setCalendarSelection(null);
    setCalendarPanelDraft(null);
    setCalendarPanelFiles([]);
    setCalendarPanelRemovedAttachmentPaths([]);
    setCalendarPanelError("");
    setCalendarPanelMessage("");
    setCalendarPanelSaving(false);
    setCalendarPanelDeleting(false);
  };

  const buildTaskCalendarPanelDraft = (occurrence, template) => ({
    kind: "task",
    occurrenceId: occurrence.id,
    parentId: occurrence.taskId || template?.id || "",
    title: String(occurrence.title || "").trim(),
    notes: String(occurrence.notes || "").trim(),
    dueAt: toDateTimeLocalValue(occurrence.dueAt),
    dueAtDisplay: formatDateTimeDisplay(occurrence.dueAt),
    status: occurrence.status || template?.statusDefault || "todo",
    priority: occurrence.priority || template?.priority || "medium",
    categoryId: occurrence.categoryId || template?.categoryId || "",
    assigneeIds: Array.isArray(occurrence.assigneeIds) ? occurrence.assigneeIds : [],
    assigneeLabel: (occurrence.assigneeEmails || []).join(", ") || "None",
    progressNote: String(occurrence.progressNote || ""),
    isRecurringOccurrence: Boolean(occurrence.isRecurring),
    seriesIsRecurring: Boolean(template?.isRecurring || occurrence.isRecurring),
    seriesRecurrence: {
      ...createDefaultRecurrence(),
      ...(template?.recurrence || {}),
      untilAt: toDateTimeLocalValue(template?.recurrence?.untilAt),
    },
    attachments: normalizeAttachmentArray(template?.attachments),
  });

  const buildEventCalendarPanelDraft = (occurrence, template) => {
    const allDay = Boolean(occurrence.allDay);
    const seriesAllDay = Boolean(
      template?.allDay === undefined ? allDay : template.allDay
    );
    return {
      kind: "event",
      occurrenceId: occurrence.id,
      parentId: occurrence.eventId || template?.id || "",
      title: String(occurrence.title || "").trim(),
      notes: String(occurrence.notes || "").trim(),
      location: String(occurrence.location || "").trim(),
      allDay,
      seriesAllDay,
      startAt: allDay
        ? toDateInputValue(occurrence.startAt)
        : toDateTimeLocalValue(occurrence.startAt),
      endAt: allDay
        ? toDateInputValue(occurrence.endAt)
        : toDateTimeLocalValue(occurrence.endAt),
      startAtDisplay: formatDateTimeDisplay(occurrence.startAt),
      endAtDisplay: formatDateTimeDisplay(occurrence.endAt),
      categoryId: occurrence.categoryId || template?.categoryId || "",
      assignmentMode: occurrence.assignmentMode || template?.assignmentMode || "optional",
      assigneeIds: Array.isArray(occurrence.assigneeIds) ? occurrence.assigneeIds : [],
      isRecurringOccurrence: Boolean(occurrence.isRecurring),
      seriesIsRecurring: Boolean(template?.isRecurring || occurrence.isRecurring),
      seriesRecurrence: {
        ...createDefaultRecurrence(),
        ...(template?.recurrence || {}),
        untilAt: seriesAllDay
          ? toDateInputValue(template?.recurrence?.untilAt)
          : toDateTimeLocalValue(template?.recurrence?.untilAt),
      },
      attachments: normalizeAttachmentArray(template?.attachments),
    };
  };

  const openTaskCalendarPanel = (occurrence) => {
    const template = tasks.find((entry) => entry.id === occurrence.taskId) || null;
    setCalendarSelection({
      kind: "task",
      occurrenceId: occurrence.id,
      parentId: occurrence.taskId || template?.id || "",
    });
    setCalendarPanelDraft(buildTaskCalendarPanelDraft(occurrence, template));
    setCalendarPanelFiles([]);
    setCalendarPanelRemovedAttachmentPaths([]);
    setCalendarPanelError("");
    setCalendarPanelMessage("");
    setCalendarPanelOpen(true);
  };

  const openEventCalendarPanel = (occurrence) => {
    const template = events.find((entry) => entry.id === occurrence.eventId) || null;
    setCalendarSelection({
      kind: "event",
      occurrenceId: occurrence.id,
      parentId: occurrence.eventId || template?.id || "",
    });
    setCalendarPanelDraft(buildEventCalendarPanelDraft(occurrence, template));
    setCalendarPanelFiles([]);
    setCalendarPanelRemovedAttachmentPaths([]);
    setCalendarPanelError("");
    setCalendarPanelMessage("");
    setCalendarPanelOpen(true);
  };

  const removeCalendarAttachment = (attachmentIndex) => {
    setCalendarPanelDraft((prev) => {
      if (!prev) return prev;
      const attachments = Array.isArray(prev.attachments) ? [...prev.attachments] : [];
      const [removed] = attachments.splice(attachmentIndex, 1);
      if (removed?.path) {
        setCalendarPanelRemovedAttachmentPaths((paths) =>
          Array.from(new Set([...paths, removed.path]))
        );
      }
      return { ...prev, attachments };
    });
  };

  const removeStoredAttachments = async (paths = []) => {
    await Promise.all(
      paths
        .filter(Boolean)
        .map((path) =>
          deleteObject(storageRef(storage, path)).catch((error) => {
            console.warn("Unable to remove attachment from storage", path, error);
          })
        )
    );
  };

  const saveTask = async () => {
    if (!isAdmin) return;
    setTaskError("");
    setTaskMessage("");
    if (!taskDraft.title.trim()) return setTaskError("Task title is required.");
    const normalized = normalizeAssigneePayload(taskDraft.assigneeIds, users);
    const payload = {
      title: taskDraft.title.trim(),
      notes: String(taskDraft.notes || "").trim(),
      statusDefault: taskDraft.statusDefault || "todo",
      priority: taskDraft.priority || "medium",
      categoryId: taskDraft.categoryId || "",
      dueAt: parseDraftDate(taskDraft.dueAt, false),
      isRecurring: Boolean(taskDraft.isRecurring),
      recurrence: taskDraft.isRecurring ? { ...createDefaultRecurrence(), ...taskDraft.recurrence, timezone: OPERATIONS_TIMEZONE } : null,
      assigneeIds: normalized.assigneeIds,
      assigneeEmails: normalized.assigneeEmails,
      reminderOffsetsMin: REMINDER_OFFSETS_MINUTES,
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
    };
    try {
      if (editingTaskId) {
        const ref = doc(db, "operationsTasks", editingTaskId);
        const existing = tasks.find((entry) => entry.id === editingTaskId);
        await updateDoc(ref, payload);
        if (taskFiles.length > 0) {
          const uploaded = await uploadAttachments("tasks", editingTaskId, taskFiles);
          await updateDoc(ref, { attachments: [...(existing?.attachments || []), ...uploaded] });
        }
        setTaskMessage("Task updated.");
      } else {
        const ref = await addDoc(collection(db, "operationsTasks"), { ...payload, attachments: [], createdAt: serverTimestamp(), createdByUid: user.uid });
        if (taskFiles.length > 0) {
          const uploaded = await uploadAttachments("tasks", ref.id, taskFiles);
          await updateDoc(ref, { attachments: uploaded });
        }
        setTaskMessage("Task created.");
      }
      setEditingTaskId(null);
      setTaskDraft(createTaskDraft());
      setTaskFiles([]);
      setTaskDialogOpen(false);
    } catch (err) {
      setTaskError(err.message || "Unable to save task.");
    }
  };

  const saveEvent = async () => {
    if (!isAdmin) return;
    setEventError("");
    setEventMessage("");
    if (!eventDraft.title.trim()) return setEventError("Event title is required.");
    if (!eventDraft.startAt) return setEventError("Event start is required.");
    const normalized = normalizeAssigneePayload(eventDraft.assigneeIds, users);
    const payload = {
      title: eventDraft.title.trim(),
      notes: String(eventDraft.notes || "").trim(),
      location: String(eventDraft.location || "").trim(),
      allDay: Boolean(eventDraft.allDay),
      startAt: parseDraftDate(eventDraft.startAt, eventDraft.allDay),
      endAt: parseDraftDate(eventDraft.endAt, eventDraft.allDay),
      categoryId: eventDraft.categoryId || "",
      assignmentMode: eventDraft.assignmentMode || "optional",
      assigneeIds: normalized.assigneeIds,
      assigneeEmails: normalized.assigneeEmails,
      isRecurring: Boolean(eventDraft.isRecurring),
      recurrence: eventDraft.isRecurring ? { ...createDefaultRecurrence(), ...eventDraft.recurrence, timezone: OPERATIONS_TIMEZONE } : null,
      reminderOffsetsMin: REMINDER_OFFSETS_MINUTES,
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
    };
    try {
      if (editingEventId) {
        const ref = doc(db, "operationsEvents", editingEventId);
        const existing = events.find((entry) => entry.id === editingEventId);
        await updateDoc(ref, payload);
        if (eventFiles.length > 0) {
          const uploaded = await uploadAttachments("events", editingEventId, eventFiles);
          await updateDoc(ref, { attachments: [...(existing?.attachments || []), ...uploaded] });
        }
        setEventMessage("Event updated.");
      } else {
        const ref = await addDoc(collection(db, "operationsEvents"), { ...payload, attachments: [], createdAt: serverTimestamp(), createdByUid: user.uid });
        if (eventFiles.length > 0) {
          const uploaded = await uploadAttachments("events", ref.id, eventFiles);
          await updateDoc(ref, { attachments: uploaded });
        }
        setEventMessage("Event created.");
      }
      setEditingEventId(null);
      setEventDraft(createEventDraft());
      setEventFiles([]);
      setEventDialogOpen(false);
    } catch (err) {
      setEventError(err.message || "Unable to save event.");
    }
  };

  const startTaskEdit = (task) => {
    setEditingTaskId(task.id);
    setTaskFiles([]);
    setTaskDraft({
      title: task.title || "",
      notes: task.notes || "",
      statusDefault: task.statusDefault || "todo",
      priority: task.priority || "medium",
      categoryId: task.categoryId || "",
      dueAt: toDateTimeLocalValue(task.dueAt),
      isRecurring: Boolean(task.isRecurring),
      recurrence: {
        ...createDefaultRecurrence(),
        ...(task.recurrence || {}),
        untilAt: toDateTimeLocalValue(task.recurrence?.untilAt),
      },
      assigneeIds: Array.isArray(task.assigneeIds) ? task.assigneeIds : [],
    });
    setTaskDialogOpen(true);
  };

  const startEventEdit = (eventItem) => {
    setEditingEventId(eventItem.id);
    setEventFiles([]);
    setEventDraft({
      title: eventItem.title || "",
      notes: eventItem.notes || "",
      location: eventItem.location || "",
      allDay: Boolean(eventItem.allDay),
      startAt: eventItem.allDay
        ? toDateInputValue(eventItem.startAt)
        : toDateTimeLocalValue(eventItem.startAt),
      endAt: eventItem.allDay
        ? toDateInputValue(eventItem.endAt)
        : toDateTimeLocalValue(eventItem.endAt),
      categoryId: eventItem.categoryId || "",
      assignmentMode: eventItem.assignmentMode || "optional",
      assigneeIds: Array.isArray(eventItem.assigneeIds) ? eventItem.assigneeIds : [],
      isRecurring: Boolean(eventItem.isRecurring),
      recurrence: {
        ...createDefaultRecurrence(),
        ...(eventItem.recurrence || {}),
        untilAt: eventItem.allDay
          ? toDateInputValue(eventItem.recurrence?.untilAt)
          : toDateTimeLocalValue(eventItem.recurrence?.untilAt),
      },
    });
    setEventDialogOpen(true);
  };

  const deleteTaskTemplate = async (taskId) => {
    if (!isAdmin) return;
    if (!window.confirm("Delete this task template and generated occurrences?")) return;
    try {
      await deleteDoc(doc(db, "operationsTasks", taskId));
      if (editingTaskId === taskId) {
        setEditingTaskId(null);
        setTaskDraft(createTaskDraft());
        setTaskFiles([]);
        setTaskDialogOpen(false);
      }
      setTaskMessage("Task deleted.");
    } catch {
      setTaskError("Unable to delete task.");
    }
  };

  const deleteEventTemplate = async (eventId) => {
    if (!isAdmin) return;
    if (!window.confirm("Delete this event template and generated occurrences?")) return;
    try {
      await deleteDoc(doc(db, "operationsEvents", eventId));
      if (editingEventId === eventId) {
        setEditingEventId(null);
        setEventDraft(createEventDraft());
        setEventFiles([]);
        setEventDialogOpen(false);
      }
      setEventMessage("Event deleted.");
    } catch {
      setEventError("Unable to delete event.");
    }
  };

  const updateCalendarPanelDraft = (patch) => {
    setCalendarPanelDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      if (
        prev.kind === "event" &&
        Object.prototype.hasOwnProperty.call(patch, "allDay") &&
        !prev.isRecurringOccurrence
      ) {
        const nextSeriesAllDay = Boolean(patch.allDay);
        next.seriesAllDay = nextSeriesAllDay;
        if (next.seriesRecurrence?.untilAt) {
          next.seriesRecurrence = {
            ...next.seriesRecurrence,
            untilAt: nextSeriesAllDay
              ? toDateInputValue(next.seriesRecurrence.untilAt)
              : toDateTimeLocalValue(next.seriesRecurrence.untilAt),
          };
        }
      }
      return next;
    });
  };

  const saveCalendarPanelItem = async () => {
    if (!calendarPanelDraft || !user) return;
    const draft = calendarPanelDraft;
    const isTaskItem = draft.kind === "task";
    const isRecurringOccurrence = Boolean(draft.isRecurringOccurrence);
    const templateId = draft.parentId || "";
    const templateCollection = isTaskItem ? "operationsTasks" : "operationsEvents";
    const occurrenceCollection = isTaskItem
      ? "operationsTaskOccurrences"
      : "operationsEventOccurrences";
    const occurrence = isTaskItem
      ? taskOccurrences.find((entry) => entry.id === draft.occurrenceId)
      : eventOccurrences.find((entry) => entry.id === draft.occurrenceId);

    if (!occurrence) {
      setCalendarPanelError("This calendar item no longer exists.");
      return;
    }

    if (isWorker && !isAdmin) {
      if (!isTaskItem) {
        setCalendarPanelError("Events are read-only for workers.");
        return;
      }
      setCalendarPanelSaving(true);
      setCalendarPanelError("");
      setCalendarPanelMessage("");
      try {
        const nextStatus = draft.status || "todo";
        await updateDoc(doc(db, occurrenceCollection, draft.occurrenceId), {
          status: nextStatus,
          progressNote: String(draft.progressNote || "").trim(),
          completedAt:
            nextStatus === "done"
              ? occurrence.completedAt || serverTimestamp()
              : null,
          completedByUid: nextStatus === "done" ? user.uid : "",
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
        });
        setCalendarPanelMessage("Task updated.");
      } catch {
        setCalendarPanelError("Unable to save task.");
      } finally {
        setCalendarPanelSaving(false);
      }
      return;
    }

    if (!isAdmin) return;

    setCalendarPanelSaving(true);
    setCalendarPanelError("");
    setCalendarPanelMessage("");

    try {
      if (!String(draft.title || "").trim()) {
        throw new Error(isTaskItem ? "Task title is required." : "Event title is required.");
      }
      if (!isTaskItem && !draft.startAt) {
        throw new Error("Event start is required.");
      }

      const normalized = normalizeAssigneePayload(draft.assigneeIds || [], users);
      const removedPaths = [...calendarPanelRemovedAttachmentPaths];
      let finalAttachments = normalizeAttachmentArray(draft.attachments);
      if (calendarPanelFiles.length > 0) {
        if (!templateId) {
          throw new Error("Unable to upload attachments without a template.");
        }
        const uploaded = await uploadAttachments(
          isTaskItem ? "tasks" : "events",
          templateId,
          calendarPanelFiles
        );
        finalAttachments = [...finalAttachments, ...uploaded];
      }

      if (isTaskItem) {
        if (isRecurringOccurrence) {
          const dueAt = parseDraftDate(draft.dueAt, false);
          const occurrenceOverride = {
            title: String(draft.title || "").trim(),
            notes: String(draft.notes || "").trim(),
            dueAt: dueAt || null,
            status: draft.status || "todo",
            priority: draft.priority || "medium",
            categoryId: draft.categoryId || "",
            assigneeIds: normalized.assigneeIds,
            assigneeEmails: normalized.assigneeEmails,
          };
          await updateDoc(doc(db, occurrenceCollection, draft.occurrenceId), {
            ...occurrenceOverride,
            progressNote: String(draft.progressNote || "").trim(),
            occurrenceOverride,
            overrideUpdatedAt: serverTimestamp(),
            overrideUpdatedByUid: user.uid,
            completedAt:
              occurrenceOverride.status === "done"
                ? occurrence.completedAt || serverTimestamp()
                : null,
            completedByUid: occurrenceOverride.status === "done" ? user.uid : "",
            isDeleted: false,
            deletedAt: null,
            deletedByUid: "",
            updatedAt: serverTimestamp(),
            updatedByUid: user.uid,
          });
          if (templateId) {
            await updateDoc(doc(db, templateCollection, templateId), {
              isRecurring: Boolean(draft.seriesIsRecurring),
              recurrence: draft.seriesIsRecurring
                ? {
                    ...createDefaultRecurrence(),
                    ...(draft.seriesRecurrence || {}),
                    timezone: OPERATIONS_TIMEZONE,
                  }
                : null,
              attachments: finalAttachments,
              updatedAt: serverTimestamp(),
              updatedByUid: user.uid,
            });
          }
        } else {
          if (!templateId) throw new Error("Task template not found.");
          await updateDoc(doc(db, templateCollection, templateId), {
            title: String(draft.title || "").trim(),
            notes: String(draft.notes || "").trim(),
            statusDefault: draft.status || "todo",
            priority: draft.priority || "medium",
            categoryId: draft.categoryId || "",
            dueAt: parseDraftDate(draft.dueAt, false),
            isRecurring: Boolean(draft.seriesIsRecurring),
            recurrence: draft.seriesIsRecurring
              ? {
                  ...createDefaultRecurrence(),
                  ...(draft.seriesRecurrence || {}),
                  timezone: OPERATIONS_TIMEZONE,
                }
              : null,
            assigneeIds: normalized.assigneeIds,
            assigneeEmails: normalized.assigneeEmails,
            reminderOffsetsMin: REMINDER_OFFSETS_MINUTES,
            attachments: finalAttachments,
            updatedAt: serverTimestamp(),
            updatedByUid: user.uid,
          });
        }
      } else {
        if (isRecurringOccurrence) {
          const startAt = parseDraftDate(draft.startAt, draft.allDay);
          const endAt = parseDraftDate(draft.endAt, draft.allDay);
          const occurrenceOverride = {
            title: String(draft.title || "").trim(),
            notes: String(draft.notes || "").trim(),
            location: String(draft.location || "").trim(),
            allDay: Boolean(draft.allDay),
            startAt: startAt || null,
            endAt: endAt || null,
            categoryId: draft.categoryId || "",
            assignmentMode: draft.assignmentMode || "optional",
            assigneeIds: normalized.assigneeIds,
            assigneeEmails: normalized.assigneeEmails,
          };
          await updateDoc(doc(db, occurrenceCollection, draft.occurrenceId), {
            ...occurrenceOverride,
            occurrenceOverride,
            overrideUpdatedAt: serverTimestamp(),
            overrideUpdatedByUid: user.uid,
            isDeleted: false,
            deletedAt: null,
            deletedByUid: "",
            updatedAt: serverTimestamp(),
            updatedByUid: user.uid,
          });
          if (templateId) {
            await updateDoc(doc(db, templateCollection, templateId), {
              isRecurring: Boolean(draft.seriesIsRecurring),
              recurrence: draft.seriesIsRecurring
                ? {
                    ...createDefaultRecurrence(),
                    ...(draft.seriesRecurrence || {}),
                    timezone: OPERATIONS_TIMEZONE,
                  }
                : null,
              attachments: finalAttachments,
              updatedAt: serverTimestamp(),
              updatedByUid: user.uid,
            });
          }
        } else {
          if (!templateId) throw new Error("Event template not found.");
          await updateDoc(doc(db, templateCollection, templateId), {
            title: String(draft.title || "").trim(),
            notes: String(draft.notes || "").trim(),
            location: String(draft.location || "").trim(),
            allDay: Boolean(draft.allDay),
            startAt: parseDraftDate(draft.startAt, draft.allDay),
            endAt: parseDraftDate(draft.endAt, draft.allDay),
            categoryId: draft.categoryId || "",
            assignmentMode: draft.assignmentMode || "optional",
            assigneeIds: normalized.assigneeIds,
            assigneeEmails: normalized.assigneeEmails,
            isRecurring: Boolean(draft.seriesIsRecurring),
            recurrence: draft.seriesIsRecurring
              ? {
                  ...createDefaultRecurrence(),
                  ...(draft.seriesRecurrence || {}),
                  timezone: OPERATIONS_TIMEZONE,
                }
              : null,
            reminderOffsetsMin: REMINDER_OFFSETS_MINUTES,
            attachments: finalAttachments,
            updatedAt: serverTimestamp(),
            updatedByUid: user.uid,
          });
        }
      }

      if (removedPaths.length > 0) {
        await removeStoredAttachments(removedPaths);
      }

      setCalendarPanelDraft((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          attachments: finalAttachments,
          assigneeIds: normalized.assigneeIds,
          assigneeLabel: normalized.assigneeEmails.join(", ") || "None",
        };
        if (prev.kind === "task") {
          next.dueAtDisplay = formatDateTimeDisplay(parseDraftDate(prev.dueAt, false));
        } else {
          next.startAtDisplay = formatDateTimeDisplay(
            parseDraftDate(prev.startAt, prev.allDay)
          );
          next.endAtDisplay = formatDateTimeDisplay(
            parseDraftDate(prev.endAt, prev.allDay)
          );
        }
        return next;
      });
      setCalendarPanelFiles([]);
      setCalendarPanelRemovedAttachmentPaths([]);
      setCalendarPanelMessage(
        isTaskItem ? "Task saved from calendar." : "Event saved from calendar."
      );
    } catch (err) {
      setCalendarPanelError(err.message || "Unable to save from calendar.");
    } finally {
      setCalendarPanelSaving(false);
    }
  };

  const deleteCalendarPanelItem = async () => {
    if (!isAdmin || !calendarPanelDraft || !user) return;
    const draft = calendarPanelDraft;
    const isTaskItem = draft.kind === "task";
    const isRecurringOccurrence = Boolean(draft.isRecurringOccurrence);
    const templateId = draft.parentId || "";
    const occurrenceCollection = isTaskItem
      ? "operationsTaskOccurrences"
      : "operationsEventOccurrences";
    const templateCollection = isTaskItem ? "operationsTasks" : "operationsEvents";

    const prompt = isRecurringOccurrence
      ? "Delete this occurrence from the calendar?"
      : "Delete this template and generated occurrences?";
    if (!window.confirm(prompt)) return;

    setCalendarPanelDeleting(true);
    setCalendarPanelError("");
    setCalendarPanelMessage("");
    try {
      if (isRecurringOccurrence) {
        await updateDoc(doc(db, occurrenceCollection, draft.occurrenceId), {
          isDeleted: true,
          deletedAt: serverTimestamp(),
          deletedByUid: user.uid,
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
        });
        clearCalendarPanel();
        return;
      }
      if (!templateId) {
        throw new Error("Template not found for deletion.");
      }
      await deleteDoc(doc(db, templateCollection, templateId));
      clearCalendarPanel();
    } catch (err) {
      setCalendarPanelError(err.message || "Unable to delete from calendar.");
    } finally {
      setCalendarPanelDeleting(false);
    }
  };

  const addCategory = async (collectionName, draft, reset, setError, setMessage) => {
    if (!isAdmin) return false;
    setError("");
    setMessage("");
    if (!String(draft.name || "").trim()) {
      setError("Category name is required.");
      return false;
    }
    try {
      await addDoc(collection(db, collectionName), {
        name: String(draft.name || "").trim(),
        color: draft.color || CATEGORY_COLORS[0],
        order: 0,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      reset();
      setMessage("Category saved.");
      return true;
    } catch {
      setError("Unable to save category.");
      return false;
    }
  };

  const editCategory = async (collectionName, category, setError, setMessage) => {
    if (!isAdmin) return;
    const nextName = window.prompt("Category name", category.name || "");
    if (nextName === null) return;
    const nextColor = window.prompt(
      "Category color hex",
      String(category.color || CATEGORY_COLORS[0])
    );
    if (nextColor === null) return;
    try {
      await updateDoc(doc(db, collectionName, category.id), {
        name: String(nextName || "").trim(),
        color: String(nextColor || CATEGORY_COLORS[0]).trim(),
        updatedAt: serverTimestamp(),
      });
      setMessage("Category updated.");
    } catch {
      setError("Unable to update category.");
    }
  };

  const removeCategory = async (collectionName, categoryId, setError) => {
    if (!isAdmin) return;
    if (!window.confirm("Delete this category?")) return;
    try {
      await deleteDoc(doc(db, collectionName, categoryId));
    } catch {
      setError("Unable to delete category.");
    }
  };

  const openCreateTaskDialog = () => {
    setTaskError("");
    setTaskMessage("");
    setEditingTaskId(null);
    setTaskDraft(createTaskDraft());
    setTaskFiles([]);
    setTaskDialogOpen(true);
  };

  const openCreateEventDialog = () => {
    setEventError("");
    setEventMessage("");
    setEditingEventId(null);
    setEventDraft(createEventDraft());
    setEventFiles([]);
    setEventDialogOpen(true);
  };

  const openTaskCategoryDialog = () => {
    setTaskError("");
    setTaskMessage("");
    setTaskCategoryDraft({ name: "", color: CATEGORY_COLORS[0] });
    setTaskCategoryDialogOpen(true);
  };

  const openEventCategoryDialog = () => {
    setEventError("");
    setEventMessage("");
    setEventCategoryDraft({ name: "", color: CATEGORY_COLORS[1] });
    setEventCategoryDialogOpen(true);
  };

  const saveTaskCategory = async () => {
    const saved = await addCategory(
      "operationsTaskCategories",
      taskCategoryDraft,
      () => setTaskCategoryDraft({ name: "", color: CATEGORY_COLORS[0] }),
      setTaskError,
      setTaskMessage
    );
    if (saved) setTaskCategoryDialogOpen(false);
  };

  const saveEventCategory = async () => {
    const saved = await addCategory(
      "operationsEventCategories",
      eventCategoryDraft,
      () => setEventCategoryDraft({ name: "", color: CATEGORY_COLORS[1] }),
      setEventError,
      setEventMessage
    );
    if (saved) setEventCategoryDialogOpen(false);
  };

  const updateOccurrenceStatus = async (occurrenceId, status) => {
    await updateDoc(doc(db, "operationsTaskOccurrences", occurrenceId), {
      status,
      completedAt: status === "done" ? serverTimestamp() : null,
      completedByUid: status === "done" ? user.uid : "",
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
    });
  };

  const saveOccurrenceNote = async (occurrenceId) => {
    await updateDoc(doc(db, "operationsTaskOccurrences", occurrenceId), {
      progressNote: String(taskNoteEdits[occurrenceId] || "").trim(),
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
    });
  };

  const onCalendarEventMove = async (info) => {
    if (!isAdmin) {
      info.revert();
      return;
    }
    if (info.event.extendedProps?.kind === "task") {
      info.revert();
      setEventError("Tasks cannot be dragged from calendar. Edit task due date in the task form.");
      return;
    }
    if (info.event.extendedProps?.isRecurring) {
      info.revert();
      setEventError("Recurring events cannot be dragged. Edit the series instead.");
      return;
    }
    const occurrenceId = info.event.extendedProps?.occurrenceId;
    const eventId = info.event.extendedProps?.eventId;
    if (!occurrenceId || !eventId) {
      info.revert();
      return;
    }
    try {
      await Promise.all([
        updateDoc(doc(db, "operationsEventOccurrences", occurrenceId), {
          startAt: info.event.start ?? null,
          endAt: info.event.end ?? null,
          updatedAt: serverTimestamp(),
        }),
        updateDoc(doc(db, "operationsEvents", eventId), {
          startAt: info.event.start ?? null,
          endAt: info.event.end ?? null,
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
        }),
      ]);
      setEventMessage("Event moved.");
    } catch {
      info.revert();
      setEventError("Unable to move event.");
    }
  };

  const onCalendarEventSelect = (info) => {
    const kind = info.event.extendedProps?.kind;
    const occurrenceId = info.event.extendedProps?.occurrenceId;
    if (!kind || !occurrenceId) return;
    if (kind === "task") {
      const occurrence = taskOccurrences.find(
        (entry) => entry.id === occurrenceId && entry.isDeleted !== true
      );
      if (!occurrence) return;
      openTaskCalendarPanel(occurrence);
      return;
    }
    const occurrence = eventOccurrences.find(
      (entry) => entry.id === occurrenceId && entry.isDeleted !== true
    );
    if (!occurrence) return;
    openEventCalendarPanel(occurrence);
  };

  const visibleTaskOccurrences = useMemo(
    () => taskOccurrences.filter((entry) => entry.isDeleted !== true),
    [taskOccurrences]
  );
  const visibleEventOccurrences = useMemo(
    () => eventOccurrences.filter((entry) => entry.isDeleted !== true),
    [eventOccurrences]
  );
  const eventCounts = useMemo(
    () => ({
      templates: events.length,
      occurrences: eventOccurrences.length,
      visibleOccurrences: visibleEventOccurrences.length,
    }),
    [events.length, eventOccurrences.length, visibleEventOccurrences.length]
  );

  useEffect(() => {
    if (!calendarPanelOpen || !calendarSelection) return;
    const exists =
      calendarSelection.kind === "task"
        ? visibleTaskOccurrences.some(
            (entry) => entry.id === calendarSelection.occurrenceId
          )
        : visibleEventOccurrences.some(
            (entry) => entry.id === calendarSelection.occurrenceId
          );
    if (!exists) clearCalendarPanel();
  }, [
    calendarPanelOpen,
    calendarSelection,
    visibleTaskOccurrences,
    visibleEventOccurrences,
  ]);

  const filteredTasks = useMemo(() => {
    const now = Date.now();
    const search = taskSearch.trim().toLowerCase();
    return visibleTaskOccurrences.filter((entry) => {
      const status = entry.status || "todo";
      const priority = entry.priority || "medium";
      const due = toDate(entry.dueAt)?.getTime() ?? 0;
      const assignees = Array.isArray(entry.assigneeIds) ? entry.assigneeIds : [];
      const categoryLabel =
        taskCategories.find((item) => item.id === entry.categoryId)?.name ||
        "Uncategorized";
      const haystack = [
        entry.title,
        entry.notes,
        entry.progressNote,
        ...(entry.assigneeEmails || []),
        categoryLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (taskStatusFilter !== "all" && status !== taskStatusFilter) return false;
      if (taskPriorityFilter !== "all" && priority !== taskPriorityFilter) return false;
      if (taskCategoryFilter !== "all" && entry.categoryId !== taskCategoryFilter) {
        return false;
      }
      if (taskAssigneeFilter !== "all" && !assignees.includes(taskAssigneeFilter)) {
        return false;
      }
      if (taskHideCompleted && status === "done") return false;
      if (search && !haystack.includes(search)) return false;
      if (taskDueWindowFilter === "overdue") return due && due < now && status !== "done";
      if (taskDueWindowFilter === "7d") {
        return due && due >= now && due <= now + 7 * 24 * 60 * 60 * 1000;
      }
      if (taskDueWindowFilter === "30d") {
        return due && due >= now && due <= now + 30 * 24 * 60 * 60 * 1000;
      }
      return true;
    });
  }, [
    visibleTaskOccurrences,
    taskStatusFilter,
    taskPriorityFilter,
    taskCategoryFilter,
    taskAssigneeFilter,
    taskHideCompleted,
    taskSearch,
    taskDueWindowFilter,
    taskCategories,
  ]);

  const filteredEvents = useMemo(() => {
    const now = Date.now();
    const search = eventSearch.trim().toLowerCase();
    return visibleEventOccurrences.filter((entry) => {
      const start = toDate(entry.startAt)?.getTime() ?? 0;
      const categoryLabel =
        eventCategories.find((item) => item.id === entry.categoryId)?.name ||
        "Uncategorized";
      const assignees = Array.isArray(entry.assigneeIds) ? entry.assigneeIds : [];
      const haystack = [
        entry.title,
        entry.notes,
        entry.location,
        ...(entry.assigneeEmails || []),
        categoryLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (search && !haystack.includes(search)) return false;
      if (!eventShowPast && start < now) return false;
      if (eventCategoryFilter !== "all" && entry.categoryId !== eventCategoryFilter) {
        return false;
      }
      if (eventAssigneeFilter !== "all" && !assignees.includes(eventAssigneeFilter)) {
        return false;
      }
      return true;
    });
  }, [
    visibleEventOccurrences,
    eventSearch,
    eventShowPast,
    eventCategoryFilter,
    eventAssigneeFilter,
    eventCategories,
  ]);

  const upcomingEvents = useMemo(() => {
    const now = Date.now();
    const end = now + 30 * 24 * 60 * 60 * 1000;
    return filteredEvents.filter((entry) => {
      const start = toDate(entry.startAt)?.getTime() ?? 0;
      return start >= now && start <= end;
    });
  }, [filteredEvents]);

  const analyticsCards = useMemo(() => {
    const now = Date.now();
    const overdue = visibleTaskOccurrences.filter((entry) => {
      const due = toDate(entry.dueAt)?.getTime();
      return due && due < now && entry.status !== "done";
    }).length;
    const dueSoon = visibleTaskOccurrences.filter((entry) => {
      const due = toDate(entry.dueAt)?.getTime();
      return due && due >= now && due <= now + 7 * 24 * 60 * 60 * 1000 && entry.status !== "done";
    }).length;
    const recent = visibleTaskOccurrences.filter((entry) => {
      const due = toDate(entry.dueAt)?.getTime() ?? 0;
      return due >= now - 30 * 24 * 60 * 60 * 1000;
    });
    const completionRate = recent.length === 0 ? 0 : Math.round((recent.filter((entry) => entry.status === "done").length / recent.length) * 100);
    return [
      { id: "overdue", label: "Overdue tasks", value: overdue, hint: "Open + overdue" },
      { id: "dueSoon", label: "Tasks due soon", value: dueSoon, hint: "Next 7 days" },
      { id: "completion", label: "Completion rate", value: `${completionRate}%`, hint: "Last 30 days" },
      { id: "upcoming", label: "Upcoming events", value: upcomingEvents.length, hint: "Next 30 days" },
      { id: "reminders", label: "Reminders sent", value: isAdmin ? adminRemindersCount : notifications.length, hint: "Last 30 days" },
    ];
  }, [visibleTaskOccurrences, upcomingEvents.length, notifications.length, isAdmin, adminRemindersCount]);

  const calendarEvents = useMemo(() => {
    const eventItems = visibleEventOccurrences
      .map((entry) => {
        const start = toDate(entry.startAt);
        if (!start) return null;
        const categoryColor =
          eventCategories.find((cat) => cat.id === entry.categoryId)?.color || "#1d4ed8";
        return {
          id: `event-${entry.id}`,
          title: buildOccurrenceEventTitle(entry),
          start,
          end: toDate(entry.endAt),
          allDay: Boolean(entry.allDay),
          editable: isAdmin && !entry.isRecurring,
          startEditable: isAdmin && !entry.isRecurring,
          durationEditable: isAdmin && !entry.isRecurring,
          backgroundColor: tintHex(categoryColor),
          borderColor: categoryColor,
          textColor: "#0f3d2e",
          extendedProps: {
            kind: "event",
            occurrenceId: entry.id,
            eventId: entry.eventId,
            isRecurring: Boolean(entry.isRecurring),
          },
        };
      })
      .filter(Boolean);

    const taskItems = visibleTaskOccurrences
      .map((entry) => {
        const due = toDate(entry.dueAt);
        if (!due) return null;
        const taskStatus = entry.status || "todo";
        const categoryColor =
          taskCategories.find((cat) => cat.id === entry.categoryId)?.color ||
          TASK_STATUS_COLORS[taskStatus] ||
          TASK_STATUS_COLORS.todo;
        return {
          id: `task-${entry.id}`,
          title: String(entry.title || "Task").trim() || "Task",
          start: due,
          allDay: false,
          editable: false,
          startEditable: false,
          durationEditable: false,
          backgroundColor: tintHex(categoryColor),
          borderColor: categoryColor,
          textColor: "#0f3d2e",
          extendedProps: {
            kind: "task",
            occurrenceId: entry.id,
            taskId: entry.taskId || "",
            isRecurring: Boolean(entry.isRecurring),
            taskStatus,
          },
        };
      })
      .filter(Boolean);

    return [...eventItems, ...taskItems];
  }, [visibleEventOccurrences, visibleTaskOccurrences, eventCategories, taskCategories, isAdmin]);

  const renderCalendarEventContent = (eventInfo) => {
    const kind = eventInfo.event.extendedProps?.kind;
    const isTaskItem = kind === "task";
    const isTaskDone = isTaskItem && eventInfo.event.extendedProps?.taskStatus === "done";
    return (
      <div className="flex items-center gap-1 overflow-hidden">
        <span
          className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded-full ${
            isTaskItem
              ? "bg-brandGreen/15 text-brandGreen"
              : "bg-blue-100 text-blue-700"
          }`}
        >
          {isTaskItem ? (
            <IconTask className="h-2.5 w-2.5" />
          ) : (
            <IconCalendar className="h-2.5 w-2.5" />
          )}
        </span>
        <span className={`truncate text-[11px] font-semibold ${isTaskDone ? "line-through opacity-70" : ""}`}>
          {eventInfo.event.title}
        </span>
      </div>
    );
  };

  if (loading || (user && !claimsReady)) return <div className={panelClass}>Loading operations...</div>;
  if (!user) return <Navigate to="/admin" replace />;
  if (!isStaff) return <div className={panelClass}>No operations access.</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brandGreen/70">Farm operations</p>
          <h1 className="text-2xl font-bold text-brandGreen">Operations Planner</h1>
          <p className="text-sm text-brandGreen/70">Timezone: {OPERATIONS_TIMEZONE} - {user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate("/admin")} className="inline-flex items-center gap-2 rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen">
            <IconBack className="h-4 w-4" />
            Admin
          </button>
          <button type="button" onClick={() => navigate("/operations?panel=alerts")} className="inline-flex items-center gap-2 rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen">
            <IconBell className="h-4 w-4" />
            {unreadNotifications.length > 0 ? unreadNotifications.length : "Alerts"}
          </button>
        </div>
      </div>

      <OperationsAnalyticsCards cards={analyticsCards} />

      <div className="flex gap-2">
        <button type="button" onClick={() => setActiveTab("tasks")} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${activeTab === "tasks" ? "bg-brandGreen text-white" : "border border-brandGreen/30 bg-white text-brandGreen"}`}>
          <IconTask className="h-4 w-4" />
          Tasks
        </button>
        <button type="button" onClick={() => setActiveTab("events")} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${activeTab === "events" ? "bg-brandGreen text-white" : "border border-brandGreen/30 bg-white text-brandGreen"}`}>
          <IconCalendar className="h-4 w-4" />
          Events
        </button>
      </div>

      {activeTab === "tasks" ? (
        <div className="space-y-4">
          {isAdmin ? (
            <div className={panelClass}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brandGreen/70">
                  Task setup
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openCreateTaskDialog}
                    className="inline-flex items-center gap-2 rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white"
                  >
                    <IconPlus className="h-4 w-4" />
                    Task
                  </button>
                  <button
                    type="button"
                    onClick={openTaskCategoryDialog}
                    className="inline-flex items-center gap-2 rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
                  >
                    <IconTag className="h-4 w-4" />
                    Category
                  </button>
                </div>
              </div>
              {taskError ? <p className="mt-2 text-sm text-red-700">{taskError}</p> : null}
              {taskMessage ? <p className="mt-2 text-sm text-emerald-700">{taskMessage}</p> : null}
              <div className="mt-3 space-y-2">
                {taskCategories.length === 0 ? (
                  <p className="text-sm text-brandGreen/70">No task categories yet.</p>
                ) : (
                  taskCategories.map((category) => (
                    <div key={category.id} className="flex items-center justify-between rounded-xl border border-brandGreen/15 bg-brandBeige/20 px-3 py-2">
                      <span className="text-sm text-brandGreen">{category.name}</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => editCategory("operationsTaskCategories", category, setTaskError, setTaskMessage)} className="inline-flex items-center rounded-full border border-brandGreen/30 p-1.5 text-brandGreen" aria-label="Edit task category" title="Edit task category">
                          <IconEdit className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => removeCategory("operationsTaskCategories", category.id, setTaskError)} className="inline-flex items-center rounded-full border border-red-300 p-1.5 text-red-700" aria-label="Delete task category" title="Delete task category">
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          <div className={panelClass}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brandGreen/70">Task occurrences</p>
              <div className="flex flex-wrap items-center gap-2">
                <select className="rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-sm text-brandGreen" value={taskStatusFilter} onChange={(event) => setTaskStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  {TASK_STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
                <label className="inline-flex items-center gap-2 rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-xs font-semibold text-brandGreen">
                  <input type="checkbox" checked={taskHideCompleted} onChange={(event) => setTaskHideCompleted(event.target.checked)} />
                  Hide completed
                </label>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <input className={inputClass} placeholder="Search tasks" value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} />
              <select className={inputClass} value={taskPriorityFilter} onChange={(event) => setTaskPriorityFilter(event.target.value)}>
                <option value="all">All priorities</option>
                {TASK_PRIORITY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <select className={inputClass} value={taskCategoryFilter} onChange={(event) => setTaskCategoryFilter(event.target.value)}>
                <option value="all">All categories</option>
                {taskCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <select className={inputClass} value={taskAssigneeFilter} onChange={(event) => setTaskAssigneeFilter(event.target.value)}>
                <option value="all">All assignees</option>
                {users.map((account) => <option key={account.id} value={account.id}>{account.email}</option>)}
              </select>
              <select className={inputClass} value={taskDueWindowFilter} onChange={(event) => setTaskDueWindowFilter(event.target.value)}>
                <option value="all">All due windows</option>
                <option value="overdue">Overdue</option>
                <option value="7d">Due in 7 days</option>
                <option value="30d">Due in 30 days</option>
              </select>
            </div>
            <div className="mt-3 space-y-2">
              {filteredTasks.length === 0 ? (
                <p className="text-sm text-brandGreen/70">No task occurrences yet.</p>
              ) : (
                filteredTasks.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-brandGreen/15 bg-brandBeige/20 p-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-brandGreen">{entry.title || "Task"}</p>
                        <p className="text-xs text-brandGreen/70">Due: {entry.dueAt ? new Date(toDate(entry.dueAt)).toLocaleString() : "-"}</p>
                        <p className="text-xs text-brandGreen/70">Assignees: {(entry.assigneeEmails || []).join(", ") || "None"}</p>
                      </div>
                      <select className="rounded-lg border border-brandGreen/30 bg-white px-3 py-2 text-sm text-brandGreen" value={entry.status || "todo"} onChange={(event) => updateOccurrenceStatus(entry.id, event.target.value)}>
                        {TASK_STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                      </select>
                    </div>
                    <div className="mt-2 grid gap-2">
                      <textarea className={inputClass} rows={2} value={taskNoteEdits[entry.id] ?? entry.progressNote ?? ""} onChange={(event) => setTaskNoteEdits((prev) => ({ ...prev, [entry.id]: event.target.value }))} />
                      <div className="flex justify-end">
                        <button type="button" onClick={() => saveOccurrenceNote(entry.id)} className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen">Save note</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {isAdmin ? (
            <div className={panelClass}>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brandGreen/70">Task templates</p>
              <div className="mt-3 space-y-2">
                {tasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between rounded-xl border border-brandGreen/15 bg-brandBeige/20 px-3 py-2">
                    <div>
                      <p className="text-sm font-semibold text-brandGreen">{task.title}</p>
                      <p className="text-xs text-brandGreen/70">{task.isRecurring ? "Recurring" : "One-time"} - {(task.assigneeEmails || []).join(", ") || "No assignees"}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => startTaskEdit(task)} className="inline-flex items-center rounded-full border border-brandGreen/30 p-1.5 text-brandGreen" aria-label={`Edit task template ${task.title || ""}`} title="Edit task template">
                        <IconEdit className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => deleteTaskTemplate(task.id)} className="inline-flex items-center rounded-full border border-red-300 p-1.5 text-red-700" aria-label={`Delete task template ${task.title || ""}`} title="Delete task template">
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {isAdmin ? (
            <div className={panelClass}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brandGreen/70">
                  Event setup
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openCreateEventDialog}
                    className="inline-flex items-center gap-2 rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white"
                  >
                    <IconPlus className="h-4 w-4" />
                    Event
                  </button>
                  <button
                    type="button"
                    onClick={openEventCategoryDialog}
                    className="inline-flex items-center gap-2 rounded-full border border-brandGreen/30 px-4 py-2 text-sm font-semibold text-brandGreen"
                  >
                    <IconTag className="h-4 w-4" />
                    Category
                  </button>
                </div>
              </div>
              {eventError ? <p className="mt-2 text-sm text-red-700">{eventError}</p> : null}
              {eventMessage ? <p className="mt-2 text-sm text-emerald-700">{eventMessage}</p> : null}
              <div className="mt-3 space-y-2">
                {eventCategories.length === 0 ? (
                  <p className="text-sm text-brandGreen/70">No event categories yet.</p>
                ) : (
                  eventCategories.map((category) => (
                    <div key={category.id} className="flex items-center justify-between rounded-xl border border-brandGreen/15 bg-brandBeige/20 px-3 py-2">
                      <span className="text-sm text-brandGreen">{category.name}</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => editCategory("operationsEventCategories", category, setEventError, setEventMessage)} className="inline-flex items-center rounded-full border border-brandGreen/30 p-1.5 text-brandGreen" aria-label="Edit event category" title="Edit event category">
                          <IconEdit className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => removeCategory("operationsEventCategories", category.id, setEventError)} className="inline-flex items-center rounded-full border border-red-300 p-1.5 text-red-700" aria-label="Delete event category" title="Delete event category">
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          <div className={panelClass}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brandGreen/70">Calendar + upcoming events</p>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-brandGreen">
                <input type="checkbox" checked={eventShowPast} onChange={(event) => setEventShowPast(event.target.checked)} />
                Show past
              </label>
            </div>
            <p className="mt-2 text-xs text-brandGreen/70">
              Diagnostics: templates {eventCounts.templates}, occurrences {eventCounts.occurrences}, visible {eventCounts.visibleOccurrences}
            </p>
            {eventTemplateQueryError || eventQueryError ? (
              <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
                {eventTemplateQueryError ? <p>Template listener: {eventTemplateQueryError}</p> : null}
                {eventQueryError ? <p>Occurrence listener: {eventQueryError}</p> : null}
              </div>
            ) : null}
            {!eventTemplateQueryError && !eventQueryError && eventCounts.templates > 0 && eventCounts.occurrences === 0 ? (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Occurrences missing. Check <code>syncOperationsEventOccurrences</code> deployment/logs.
              </div>
            ) : null}
            {!eventTemplateQueryError && !eventQueryError && eventCounts.occurrences > 0 && eventCounts.visibleOccurrences === 0 ? (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                All event occurrences are currently soft-deleted (<code>isDeleted === true</code>).
              </div>
            ) : null}
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <input className={inputClass} placeholder="Search events" value={eventSearch} onChange={(event) => setEventSearch(event.target.value)} />
              <select className={inputClass} value={eventCategoryFilter} onChange={(event) => setEventCategoryFilter(event.target.value)}>
                <option value="all">All categories</option>
                {eventCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <select className={inputClass} value={eventAssigneeFilter} onChange={(event) => setEventAssigneeFilter(event.target.value)}>
                <option value="all">All assignees</option>
                {users.map((account) => <option key={account.id} value={account.id}>{account.email}</option>)}
              </select>
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs font-semibold text-brandGreen/80">
              <span className="inline-flex items-center gap-1 rounded-full border border-brandGreen/20 bg-brandBeige/20 px-2 py-1">
                <IconCalendar className="h-3.5 w-3.5" />
                Events
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-brandGreen/20 bg-brandBeige/20 px-2 py-1">
                <IconTask className="h-3.5 w-3.5" />
                Tasks
              </span>
            </div>
            <div className="mt-2 mx-auto w-full max-w-5xl rounded-xl border border-brandGreen/15 bg-white p-2">
              <FullCalendar
                plugins={[dayGridPlugin, interactionPlugin, rrulePlugin]}
                initialView="dayGridMonth"
                editable={isAdmin}
                events={calendarEvents}
                eventDrop={onCalendarEventMove}
                eventResize={onCalendarEventMove}
                eventClick={onCalendarEventSelect}
                eventContent={renderCalendarEventContent}
                height={560}
                dayMaxEvents={2}
                dayMaxEventRows={2}
                fixedWeekCount
              />
            </div>
            <div className="mt-3 space-y-2">
              {upcomingEvents.length === 0 ? (
                <p className="text-sm text-brandGreen/70">No upcoming events in next 30 days.</p>
              ) : (
                upcomingEvents.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-brandGreen/15 bg-brandBeige/20 p-3">
                    <p className="inline-flex items-center gap-1 text-sm font-semibold text-brandGreen">
                      <IconCalendar className="h-4 w-4" />
                      {entry.title || "Event"}
                    </p>
                    <p className="text-xs text-brandGreen/70">{entry.startAt ? new Date(toDate(entry.startAt)).toLocaleString() : "-"} {entry.location ? ` - ${entry.location}` : ""}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {isAdmin ? (
            <div className={panelClass}>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brandGreen/70">Event templates</p>
              <div className="mt-3 space-y-2">
                {events.map((eventItem) => (
                  <div key={eventItem.id} className="flex items-center justify-between rounded-xl border border-brandGreen/15 bg-brandBeige/20 px-3 py-2">
                    <div>
                      <p className="text-sm font-semibold text-brandGreen">{eventItem.title}</p>
                      <p className="text-xs text-brandGreen/70">{eventItem.isRecurring ? "Recurring" : "One-time"} - {(eventItem.assigneeEmails || []).join(", ") || "No assignees"}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => startEventEdit(eventItem)} className="inline-flex items-center rounded-full border border-brandGreen/30 p-1.5 text-brandGreen" aria-label={`Edit event template ${eventItem.title || ""}`} title="Edit event template">
                        <IconEdit className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => deleteEventTemplate(eventItem.id)} className="inline-flex items-center rounded-full border border-red-300 p-1.5 text-red-700" aria-label={`Delete event template ${eventItem.title || ""}`} title="Delete event template">
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <OperationsDialog
        isOpen={isAdmin && taskDialogOpen}
        title={editingTaskId ? "Edit task template" : "Create task template"}
        onClose={() => {
          setTaskDialogOpen(false);
          setEditingTaskId(null);
          setTaskDraft(createTaskDraft());
          setTaskFiles([]);
        }}
      >
        <div className="grid gap-2">
          <input className={inputClass} placeholder="Title" value={taskDraft.title} onChange={(event) => setTaskDraft((prev) => ({ ...prev, title: event.target.value }))} />
          <textarea className={inputClass} rows={3} placeholder="Notes" value={taskDraft.notes} onChange={(event) => setTaskDraft((prev) => ({ ...prev, notes: event.target.value }))} />
          <div className="grid gap-2 md:grid-cols-3">
            <select className={inputClass} value={taskDraft.statusDefault} onChange={(event) => setTaskDraft((prev) => ({ ...prev, statusDefault: event.target.value }))}>
              {TASK_STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <select className={inputClass} value={taskDraft.priority} onChange={(event) => setTaskDraft((prev) => ({ ...prev, priority: event.target.value }))}>
              {TASK_PRIORITY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <select className={inputClass} value={taskDraft.categoryId} onChange={(event) => setTaskDraft((prev) => ({ ...prev, categoryId: event.target.value }))}>
              <option value="">No category</option>
              {taskCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
          <input type="datetime-local" className={inputClass} value={taskDraft.dueAt} onChange={(event) => setTaskDraft((prev) => ({ ...prev, dueAt: event.target.value }))} />
          <AssigneeDropdown
            users={users}
            selectedIds={taskDraft.assigneeIds}
            onChange={(nextIds) =>
              setTaskDraft((prev) => ({ ...prev, assigneeIds: nextIds }))
            }
            placeholder="Assign team member"
          />
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-brandGreen">
            <input type="checkbox" checked={taskDraft.isRecurring} onChange={(event) => setTaskDraft((prev) => ({ ...prev, isRecurring: event.target.checked, recurrence: event.target.checked ? prev.recurrence : createDefaultRecurrence() }))} />
            Recurring
          </label>
          {taskDraft.isRecurring ? (
            <RecurrenceFields recurrence={taskDraft.recurrence || createDefaultRecurrence()} onChange={(next) => setTaskDraft((prev) => ({ ...prev, recurrence: next }))} />
          ) : null}
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className={inputClass} onChange={(event) => setTaskFiles(Array.from(event.target.files || []))} />
        </div>
        {taskError ? <p className="mt-2 text-sm text-red-700">{taskError}</p> : null}
        {taskMessage ? <p className="mt-2 text-sm text-emerald-700">{taskMessage}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => { setTaskDialogOpen(false); setEditingTaskId(null); setTaskDraft(createTaskDraft()); setTaskFiles([]); }} className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen">Cancel</button>
          <button type="button" onClick={saveTask} className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white">{editingTaskId ? "Save task" : "Create task"}</button>
        </div>
      </OperationsDialog>

      <OperationsDialog
        isOpen={isAdmin && eventDialogOpen}
        title={editingEventId ? "Edit event template" : "Create event template"}
        onClose={() => {
          setEventDialogOpen(false);
          setEditingEventId(null);
          setEventDraft(createEventDraft());
          setEventFiles([]);
        }}
      >
        <div className="grid gap-2">
          <input className={inputClass} placeholder="Title" value={eventDraft.title} onChange={(event) => setEventDraft((prev) => ({ ...prev, title: event.target.value }))} />
          <textarea className={inputClass} rows={2} placeholder="Notes" value={eventDraft.notes} onChange={(event) => setEventDraft((prev) => ({ ...prev, notes: event.target.value }))} />
          <input className={inputClass} placeholder="Location" value={eventDraft.location} onChange={(event) => setEventDraft((prev) => ({ ...prev, location: event.target.value }))} />
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-brandGreen">
            <input type="checkbox" checked={eventDraft.allDay} onChange={(event) => setEventDraft((prev) => ({ ...prev, allDay: event.target.checked, startAt: "", endAt: "" }))} />
            All day
          </label>
          <div className="grid gap-2 md:grid-cols-2">
            <input type={eventDraft.allDay ? "date" : "datetime-local"} className={inputClass} value={eventDraft.startAt} onChange={(event) => setEventDraft((prev) => ({ ...prev, startAt: event.target.value }))} />
            <input type={eventDraft.allDay ? "date" : "datetime-local"} className={inputClass} value={eventDraft.endAt} onChange={(event) => setEventDraft((prev) => ({ ...prev, endAt: event.target.value }))} />
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <select className={inputClass} value={eventDraft.categoryId} onChange={(event) => setEventDraft((prev) => ({ ...prev, categoryId: event.target.value }))}>
              <option value="">No category</option>
              {eventCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select className={inputClass} value={eventDraft.assignmentMode} onChange={(event) => setEventDraft((prev) => ({ ...prev, assignmentMode: event.target.value }))}>
              <option value="optional">Assignees optional</option>
              <option value="required">Assignees required</option>
            </select>
            <AssigneeDropdown
              users={users}
              selectedIds={eventDraft.assigneeIds}
              onChange={(nextIds) =>
                setEventDraft((prev) => ({ ...prev, assigneeIds: nextIds }))
              }
              placeholder="Assign people"
              compact
            />
          </div>
          {Array.isArray(eventDraft.assigneeIds) && eventDraft.assigneeIds.length > 0 ? (
            <div className="rounded-lg border border-brandGreen/15 bg-brandBeige/20 p-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-brandGreen/70">
                Selected assignees
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {eventDraft.assigneeIds.map((assigneeId) => {
                  const account = users.find((entry) => entry.id === assigneeId);
                  const label = account?.email || assigneeId;
                  return (
                    <span
                      key={assigneeId}
                      className="inline-flex items-center gap-2 rounded-full border border-brandGreen/25 bg-brandBeige/30 px-3 py-1 text-xs font-semibold text-brandGreen"
                    >
                      <span>{label}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setEventDraft((prev) => ({
                            ...prev,
                            assigneeIds: (prev.assigneeIds || []).filter(
                              (id) => id !== assigneeId
                            ),
                          }))
                        }
                        className="rounded-full border border-brandGreen/30 px-1 text-[10px] leading-none"
                        aria-label={`Remove ${label}`}
                      >
                        x
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-brandGreen">
            <input type="checkbox" checked={eventDraft.isRecurring} onChange={(event) => setEventDraft((prev) => ({ ...prev, isRecurring: event.target.checked, recurrence: event.target.checked ? prev.recurrence : createDefaultRecurrence() }))} />
            Recurring
          </label>
          {eventDraft.isRecurring ? (
            <RecurrenceFields recurrence={eventDraft.recurrence || createDefaultRecurrence()} onChange={(next) => setEventDraft((prev) => ({ ...prev, recurrence: next }))} dateOnly={eventDraft.allDay} />
          ) : null}
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className={inputClass} onChange={(event) => setEventFiles(Array.from(event.target.files || []))} />
        </div>
        {eventError ? <p className="mt-2 text-sm text-red-700">{eventError}</p> : null}
        {eventMessage ? <p className="mt-2 text-sm text-emerald-700">{eventMessage}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => { setEventDialogOpen(false); setEditingEventId(null); setEventDraft(createEventDraft()); setEventFiles([]); }} className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen">Cancel</button>
          <button type="button" onClick={saveEvent} className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white">{editingEventId ? "Save event" : "Create event"}</button>
        </div>
      </OperationsDialog>

      <OperationsDialog
        isOpen={isAdmin && taskCategoryDialogOpen}
        title="Create task category"
        onClose={() => setTaskCategoryDialogOpen(false)}
        maxWidthClass="max-w-xl"
      >
        <div className="grid gap-2">
          <input className={inputClass} placeholder="Category name" value={taskCategoryDraft.name} onChange={(event) => setTaskCategoryDraft((prev) => ({ ...prev, name: event.target.value }))} />
          <select className={inputClass} value={taskCategoryDraft.color} onChange={(event) => setTaskCategoryDraft((prev) => ({ ...prev, color: event.target.value }))}>
            {CATEGORY_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}
          </select>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => setTaskCategoryDialogOpen(false)} className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen">Cancel</button>
          <button type="button" onClick={saveTaskCategory} className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white">Save category</button>
        </div>
      </OperationsDialog>

      <OperationsDialog
        isOpen={isAdmin && eventCategoryDialogOpen}
        title="Create event category"
        onClose={() => setEventCategoryDialogOpen(false)}
        maxWidthClass="max-w-xl"
      >
        <div className="grid gap-2">
          <input className={inputClass} placeholder="Category name" value={eventCategoryDraft.name} onChange={(event) => setEventCategoryDraft((prev) => ({ ...prev, name: event.target.value }))} />
          <select className={inputClass} value={eventCategoryDraft.color} onChange={(event) => setEventCategoryDraft((prev) => ({ ...prev, color: event.target.value }))}>
            {CATEGORY_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}
          </select>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => setEventCategoryDialogOpen(false)} className="rounded-full border border-brandGreen/30 px-3 py-1 text-xs font-semibold text-brandGreen">Cancel</button>
          <button type="button" onClick={saveEventCategory} className="rounded-full bg-brandGreen px-4 py-2 text-sm font-semibold text-white">Save category</button>
        </div>
      </OperationsDialog>

      <OperationsCalendarItemPanel
        isOpen={calendarPanelOpen}
        draft={calendarPanelDraft}
        users={users}
        taskCategories={taskCategories}
        eventCategories={eventCategories}
        taskStatusOptions={TASK_STATUS_OPTIONS}
        taskPriorityOptions={TASK_PRIORITY_OPTIONS}
        isAdmin={isAdmin}
        isWorker={isWorker}
        pendingFiles={calendarPanelFiles}
        saving={calendarPanelSaving}
        deleting={calendarPanelDeleting}
        error={calendarPanelError}
        message={calendarPanelMessage}
        onClose={clearCalendarPanel}
        onChangeDraft={updateCalendarPanelDraft}
        onPendingFilesChange={setCalendarPanelFiles}
        onSave={saveCalendarPanelItem}
        onDelete={deleteCalendarPanelItem}
        onRemoveAttachment={removeCalendarAttachment}
      />

      <OperationsAlertsPanel isOpen={alertsOpen} notifications={notifications} unreadCount={unreadNotifications.length} onClose={() => navigate("/operations")} />
    </div>
  );
}
