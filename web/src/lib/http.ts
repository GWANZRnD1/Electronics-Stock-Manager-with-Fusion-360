/** Helpers for mapping Postgres errors to HTTP responses. */

function pgCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

export function isUniqueViolation(e: unknown): boolean {
  return pgCode(e) === "23505";
}

export function isForeignKeyViolation(e: unknown): boolean {
  return pgCode(e) === "23503";
}
