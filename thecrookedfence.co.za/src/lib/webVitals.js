import { onCLS, onINP, onLCP } from "web-vitals";
import { logEvent } from "./telemetry.js";

export const initWebVitals = () => {
  onCLS((metric) => logEvent("web_vital_cls", metric));
  onINP((metric) => logEvent("web_vital_inp", metric));
  onLCP((metric) => logEvent("web_vital_lcp", metric));
};
