import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const FORBIDDEN_IN_DOMAIN = [
  "next",
  "next/*",
  "react",
  "react/*",
  "react-dom",
  "react-dom/*",
  "@prisma/client",
  "@prisma/client/*",
  "@/server",
  "@/server/*",
  "@/app",
  "@/app/*",
  "**/src/server",
  "**/src/server/*",
  "**/src/app",
  "**/src/app/*",
  "../server",
  "../server/*",
  "../app",
  "../app/*",
  "../../server",
  "../../server/*",
  "../../app",
  "../../app/*",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: FORBIDDEN_IN_DOMAIN,
              message:
                "src/domain is pure TypeScript: it must not import next, react, @prisma/client, src/server or src/app.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores(["generated/**", ".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
