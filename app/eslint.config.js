import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const DIRECTIVE = /^\s*(eslint-|global\b|@ts-expect-error)/;

const noComments = {
  meta: { type: "suggestion", schema: [], messages: { comment: "Write no comment; put the reason in a name or a test." } },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang" || DIRECTIVE.test(comment.value)) continue;
          context.report({ loc: comment.loc, messageId: "comment" });
        }
      },
    };
  },
};

export default tseslint.config(
  { ignores: ["**/dist/**", "**/target/**", "**/gen/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["app/src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ["app/**/*.{ts,tsx,js}", "scripts/**/*.mjs"],
    plugins: { local: { rules: { "no-comments": noComments } } },
    rules: { "local/no-comments": "error" },
  },
  {
    files: ["app/vite.config.ts", "scripts/**/*.mjs", "app/eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
);
