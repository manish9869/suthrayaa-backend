/** Strips characters with special meaning in PostgREST's filter query syntax before use in .or()/.ilike(). */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%*]/g, "").trim().slice(0, 100);
}
