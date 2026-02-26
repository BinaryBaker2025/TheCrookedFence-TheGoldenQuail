import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const safelyParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
};

export function useDraftPersistence({
  storageKey,
  initialValue,
  schemaVersion = 1,
  ttlMs = DEFAULT_TTL_MS,
  debounceMs = 300,
}) {
  const readInitialValue = () => {
    if (typeof window === "undefined" || !storageKey) return initialValue;

    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return initialValue;

    const parsed = safelyParseJson(raw);
    if (!parsed || typeof parsed !== "object") return initialValue;

    const savedAt = Number(parsed.savedAt || 0);
    const version = Number(parsed.schemaVersion || 0);
    const expired = !savedAt || Date.now() - savedAt > ttlMs;

    if (expired || version !== schemaVersion) {
      window.localStorage.removeItem(storageKey);
      return initialValue;
    }

    return parsed.value ?? initialValue;
  };

  const [value, setValue] = useState(readInitialValue);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined" || !storageKey) return undefined;

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      const savedAt = Date.now();
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          schemaVersion,
          savedAt,
          value,
        })
      );
      setLastSavedAt(savedAt);
    }, debounceMs);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [storageKey, schemaVersion, value, debounceMs]);

  const hasDraft = useMemo(() => {
    if (typeof window === "undefined" || !storageKey) return false;
    return Boolean(window.localStorage.getItem(storageKey));
  }, [storageKey, value]);

  const clearDraft = () => {
    if (typeof window === "undefined" || !storageKey) return;
    window.localStorage.removeItem(storageKey);
    setLastSavedAt(null);
  };

  return {
    value,
    setValue,
    hasDraft,
    clearDraft,
    lastSavedAt,
  };
}
