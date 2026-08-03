/**
 * Process configuration. This is the only place in the API that reads the
 * environment; `packages/core` never does (spec §6).
 */

function required(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return Bun.env[name] ?? fallback;
}

export const env = {
  port: Number(optional("API_PORT", "3001")),
  sessionSecret: required("SESSION_SECRET"),
  sessionTtlHours: Number(optional("SESSION_TTL_HOURS", "168")),
  corsOrigins: optional("CORS_ORIGINS", "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  isProduction: optional("NODE_ENV", "development") === "production",
  isTest: optional("NODE_ENV", "development") === "test",
} as const;
