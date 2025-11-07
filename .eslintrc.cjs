module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true
  },
  extends: ["next/core-web-vitals", "prettier"],
  ignorePatterns: ["dist", ".next"],
  rules: {
    "no-console": ["warn", { allow: ["warn", "error"] }]
  }
};
