import { useState } from "react";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function useSubmissionQueue() {
  const [isRetrying, setIsRetrying] = useState(false);
  const [lastError, setLastError] = useState(null);

  const runWithRetry = async (task, options = {}) => {
    const retries = Number.isFinite(options.retries) ? options.retries : 3;
    const baseDelayMs = Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : 400;

    let attempt = 0;
    setIsRetrying(true);
    setLastError(null);

    while (attempt <= retries) {
      try {
        const result = await task({ attempt });
        setIsRetrying(false);
        return result;
      } catch (error) {
        setLastError(error);
        if (attempt >= retries) {
          setIsRetrying(false);
          throw error;
        }
        const backoff = baseDelayMs * 2 ** attempt;
        await wait(backoff);
      }
      attempt += 1;
    }

    setIsRetrying(false);
    throw new Error("Submission failed unexpectedly.");
  };

  return {
    isRetrying,
    lastError,
    runWithRetry,
  };
}
