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
    // Overriding the defaults drops ESLint's own built-in ignores too
    // (node_modules, dotfiles), so they need restating here.
    "node_modules/**",
    ".vercel/**",
    "services/**",
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
