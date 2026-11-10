import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Report exports fire ~25 queries at once. Prisma's defaults (10s wait for a free connection, 5s to
 * connect) time out on small serverless machines, so wait longer instead, unless DATABASE_URL already
 * sets these. The pool stays small: prod is Aiven's free Postgres, connected directly with no pooler,
 * and every serverless instance opens its own pool against a small server-wide connection limit. */
function datasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "5");
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "120");
    // Opening several connections at once can exceed the 5s default.
    if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "30");
    return url.toString();
  } catch {
    return raw;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: datasourceUrl(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
