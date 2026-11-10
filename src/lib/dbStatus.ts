import { Prisma } from "@prisma/client";

/** Prisma codes for "the database could not be reached", as opposed to a bad query:
 * P1001 can't reach server, P1002 timed out, P1008 operation timed out, P1017 server closed the
 * connection, P2024 timed out waiting for a pooled connection. */
const UNREACHABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

export const DB_UNAVAILABLE_MESSAGE =
  "The database is unavailable. It may be powered off or out of free-tier quota — check the Aiven console, then try again.";

/** True when the error means the database is down or unreachable (not a bug in a query). */
export function isDatabaseUnavailable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) return UNREACHABLE_CODES.has(err.code);
  if (err instanceof Prisma.PrismaClientRustPanicError) return true;
  return false;
}
