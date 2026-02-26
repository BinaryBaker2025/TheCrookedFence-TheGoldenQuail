import { useEffect, useMemo, useState } from "react";

export function useNetworkStatus() {
  const getInitial = () => {
    if (typeof navigator === "undefined") return true;
    if (typeof navigator.onLine !== "boolean") return true;
    return navigator.onLine;
  };

  const [isOnline, setIsOnline] = useState(getInitial);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const statusLabel = useMemo(
    () => (isOnline ? "Online" : "Offline. We will retry when connection returns."),
    [isOnline]
  );

  return { isOnline, statusLabel };
}
