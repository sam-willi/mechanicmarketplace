import { parseCursor, type Cursor } from "./normalized/reader";

export { parseCursor, type Cursor };

/** (field, id) in JavaScript string order, which is the live queries' order (collate "C"). */
function compare<T extends { id: string }>(field: (x: T) => string | undefined) {
  return (a: T, b: T) => {
    const fa = field(a) ?? "";
    const fb = field(b) ?? "";
    if (fa !== fb) return fa < fb ? -1 : 1;
    return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
  };
}

/**
 * One page of a list, newest first by (field, id), as the live queries sort. Rows at or
 * before the cursor are skipped; `next` is the cursor for the following page, or undefined
 * on the last one. A stale cursor (its row since removed or changed) still pages correctly:
 * it's a position, not a row reference. The list is sorted here, whatever order it came in.
 */
export function paginate<T extends { id: string }>(list: T[], field: (x: T) => string | undefined, limit: number, before?: Cursor) {
  const cmp = compare(field);
  const sorted = [...list].sort((a, b) => cmp(b, a));
  return page(sorted, field, limit, before ? (x) => {
    const at = field(x) ?? "";
    return at < before.at || (at === before.at && x.id < before.id);
  } : undefined);
}

/** Same, oldest first (the staff queue). */
export function paginateAsc<T extends { id: string }>(list: T[], field: (x: T) => string | undefined, limit: number, after?: Cursor) {
  const cmp = compare(field);
  const sorted = [...list].sort(cmp);
  return page(sorted, field, limit, after ? (x) => {
    const at = field(x) ?? "";
    return at > after.at || (at === after.at && x.id > after.id);
  } : undefined);
}

function page<T extends { id: string }>(sorted: T[], field: (x: T) => string | undefined, limit: number, keep?: (x: T) => boolean) {
  const rest = keep ? sorted.filter(keep) : sorted;
  const items = rest.slice(0, limit);
  const last = items.at(-1);
  const next = rest.length > limit && last ? `${field(last) ?? ""}~${last.id}` : undefined;
  return { items, next };
}
