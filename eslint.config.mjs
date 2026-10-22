import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // App data (SQLite, teammate workspaces, business Chrome profiles) and test data.
    "data/**",
    ".test-data/**",
    ".next-*/**",
    "dist/**",
    ".claude/**",
  ]),
  // The Electron shell is plain CommonJS (Electron's main and sandboxed preload).
  { files: ["electron/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
]);

export default eslintConfig;
