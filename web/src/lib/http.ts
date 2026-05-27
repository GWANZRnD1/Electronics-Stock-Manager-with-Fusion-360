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

/** Name of the violated unique constraint (e.g. "locations_aruco_uq"), if any. */
export function uniqueViolationConstraint(e: unknown): string | undefined {
  if (!isUniqueViolation(e)) return undefined;
  if (typeof e === "object" && e !== null && "constraint_name" in e) {
    return (e as { constraint_name?: string }).constraint_name;
  }
  return undefined;
}

export function isForeignKeyViolation(e: unknown): boolean {
  return pgCode(e) === "23503";
}
