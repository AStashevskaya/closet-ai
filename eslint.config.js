// Lints server/ and shared/. The client has its own config (eslint-config-expo) in client/.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  { ignores: ["client/**", "**/dist/**", "**/node_modules/**", "server/drizzle/**"] },
  js.configs.recommended,
  // Type-aware rules catch async mistakes such as a promise nobody awaits.
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Fastify plugins must be async functions even when they await nothing.
      "@typescript-eslint/require-await": "off",
      // `_` marks values that are destructured away on purpose.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Config files at the root are not part of any tsconfig.
    files: ["eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
]);
