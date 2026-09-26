/**
 * Cells of the search form's ruled grid. Plain module (not "use client") so
 * both the server form and the client vehicle picker can share the strings.
 * The grid draws its rules with a 1px gap over rule-soft; each cell is sheet.
 */
export const SEARCH_GRID = "grid grid-cols-2 gap-px overflow-visible border border-rule bg-rule-soft lg:grid-cols-4";
export const SEARCH_CELL =
  "relative block min-w-0 bg-sheet px-3.5 pt-2.5 pb-2 transition-colors focus-within:bg-brand-wash/60 focus-within:shadow-[inset_0_0_0_2px_var(--brand)] hover:bg-paper/60";
/** Wide on phones (spans both columns), one column from lg. */
export const SEARCH_CELL_WIDE = `${SEARCH_CELL} col-span-2 lg:col-span-1`;
/** The bare control inside a cell: no box of its own, the cell is the field. */
export const SEARCH_CONTROL =
  "search-control mt-0.5 block w-full min-w-0 appearance-none truncate bg-transparent py-1 pr-7 text-[1rem] font-semibold text-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:text-ink-3";
