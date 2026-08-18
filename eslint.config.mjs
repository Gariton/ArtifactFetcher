import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      "@typescript-eslint/ban-ts-comment": "error",
      // Mantine's form.onSubmit wrapper receives callbacks that close over refs;
      // the compiler-oriented rule treats this normal event-handler pattern as
      // a render-time ref read even though the callback only runs on submit.
      "react-hooks/refs": "off",
      // The SSE reconnect callback intentionally schedules itself after the
      // current invocation; this is not a render-time mutation.
      "react-hooks/immutability": "off"
    }
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
