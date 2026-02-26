const isDev = import.meta.env.DEV;

export const logEvent = (eventName, payload = {}) => {
  if (isDev) {
    console.info(`[telemetry:event] ${eventName}`, payload);
  }
};

export const logError = (context, error, payload = {}) => {
  const safeError =
    error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error || "Unknown error") };
  console.error(`[telemetry:error] ${context}`, { ...payload, error: safeError });
};
