import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "~": resolve(__dirname, "./src"),
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    exclude: ["node_modules", ".next", "tests/e2e/**"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      reporter: ["text", "html"],
      exclude: ["**/*.config.*", "**/.next/**", "tests/**"],
    },
  },
});
