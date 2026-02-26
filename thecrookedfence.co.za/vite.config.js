import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (
              id.includes("firebase") ||
              id.includes("@firebase") ||
              id.includes("idb")
            ) {
              return "firebase";
            }
            if (
              id.includes("jspdf") ||
              id.includes("jspdf-autotable") ||
              id.includes("html2canvas")
            ) {
              return "pdf";
            }
            if (
              id.includes("@fullcalendar") ||
              id.includes("rrule")
            ) {
              return "calendar";
            }
            return "vendor";
          }
          return null;
        },
      },
    },
  },
});
