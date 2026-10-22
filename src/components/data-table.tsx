import type { MouseEvent, ReactNode } from "react";
import { RowOpenButton, RowShell, TableSearch } from "@/components/data-table-parts";
import { cn } from "@/lib/utils";

/**
 * Notion database view (UI-PLAN §2.5). No outer card: a 34px header row (12px tertiary,
 * optional 16px property icon), 34px body rows on hairlines, first column 14px 500 with a
 * hover-revealed "Open" button, hover tint, selected row in primary-soft. Rows are
 * focusable: ↑↓ move, Enter opens. Scrolls horizontally below `minWidth`.
 *
 * Server- and client-safe (no directive): from a server page pass `rowHref` (strings);
 * client callers may pass `onRowOpen` instead. `cell` runs wherever the table renders.
 *
 *   <DataTable
 *     rows={contacts}
 *     getRowId={(c) => c.id}
 *     rowHref={(c) => `?c=${c.id}`}                 // or onRowOpen={(c) => peek.open(c.id)}
 *     selectedId={c}
 *     columns={[
 *       { key: "name", header: "Name", icon: <Type />, cell: (c) => c.name },
 *       { key: "kind", header: "Kind", icon: <Tag />, width: 120, cell: (c) => <Badge>{c.kind}</Badge> },
 *     ]}
 *     empty={<EmptyState icon={<Users />} title="No people yet" />}
 *   />
 *
 * Above it: `DataTableToolbar` (views left; `TableSearch`, filter/sort, "New" right).
 * For visual files: `Gallery` + `GalleryTile`.
 */

export { TableSearch };

export type Column<T> = {
  key: string;
  header: ReactNode;
  /** 16px lucide icon for the property type (Type, Hash, Tag, Calendar, Phone…). */
  icon?: ReactNode;
  /** px; columns without a width share the rest. */
  width?: number;
  align?: "left" | "right";
  cell: (row: T) => ReactNode;
  /** Plain text for the cell's title tooltip (cells truncate). */
  title?: (row: T) => string | undefined;
  className?: string;
};

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  rowHref,
  onRowOpen,
  selectedId,
  empty,
  minWidth = 640,
  className,
  label,
}: {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  /** Where Enter/click goes (e.g. `?d=id` to open a side peek). */
  rowHref?: (row: T) => string;
  /** Client callers: run on click/Enter instead of navigating. */
  onRowOpen?: (row: T) => void;
  selectedId?: string | null;
  /** Shown instead of the table when there are no rows (an EmptyState). */
  empty?: ReactNode;
  /** Below this width the table scrolls sideways. */
  minWidth?: number;
  className?: string;
  /** aria-label for the table. */
  label?: string;
}) {
  if (!rows.length && empty) return <>{empty}</>;
  const interactive = Boolean(onRowOpen || rowHref);

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table aria-label={label} className="w-full table-fixed border-collapse text-[13px] leading-[18px]" style={{ minWidth }}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr className="h-[34px] border-b border-border">
            {columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                className={cn("px-2 text-left text-xs leading-4 font-medium whitespace-nowrap text-tertiary", i === 0 && "pl-0", c.align === "right" && "text-right")}
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]",
                    c.align === "right" && "flex-row-reverse",
                  )}
                >
                  {c.icon}
                  {c.header}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = getRowId(row);
            return (
              <RowShell
                key={id}
                href={rowHref?.(row)}
                onOpen={onRowOpen ? () => onRowOpen(row) : undefined}
                selected={selectedId === id}
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    title={c.title?.(row)}
                    className={cn(
                      "max-w-0 truncate px-2 align-middle text-foreground",
                      i === 0 ? "pl-0 text-sm leading-5 font-medium" : "text-[13px]",
                      c.align === "right" && "text-right tabular-nums",
                      c.className,
                    )}
                  >
                    {i === 0 && interactive ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1 truncate">{c.cell(row)}</div>
                        <RowOpenButton />
                      </div>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
              </RowShell>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The bar above a table: views (LineTabs from @/components/kit) on the left, then search /
 * filter / sort / "New" on the right. Wraps on a phone.
 */
export function DataTableToolbar({ views, children, className }: { views?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-2 flex min-h-8 flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0 flex-1">{views}</div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-1.5 pb-0.5">{children}</div>}
    </div>
  );
}

/** Gallery view (Files, Library): tiles ≥160px wide, 16px gap. */
export function Gallery({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4", className)}>{children}</div>;
}

/**
 * One gallery tile: an 8px-radius 4:3 thumb on bg-muted, caption 13/18 500 under it and a
 * 12px meta line. `selected` draws a ring; `topLeft` / `topRight` show on hover (a
 * checkbox, a "…" menu); `badge` stays visible until hover (a star). `href` or `onClick`.
 */
export function GalleryTile({
  thumb,
  caption,
  meta,
  selected,
  href,
  onClick,
  topLeft,
  topRight,
  badge,
}: {
  thumb: ReactNode;
  caption: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
  href?: string;
  onClick?: (e: MouseEvent) => void;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  badge?: ReactNode;
}) {
  const inner = (
    <span
      className={cn(
        "relative block aspect-[4/3] overflow-hidden rounded-lg bg-muted ring-1 ring-black/5 ring-inset transition-shadow duration-100 [&_img]:size-full [&_img]:object-cover [&_video]:size-full [&_video]:object-cover",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
      )}
    >
      {thumb}
    </span>
  );
  return (
    <div className="group/tile relative min-w-0">
      {href ? (
        <a href={href} onClick={onClick} className="block rounded-lg">
          {inner}
        </a>
      ) : (
        <button type="button" onClick={onClick} className="block w-full rounded-lg text-left">
          {inner}
        </button>
      )}
      {topLeft && (
        <div className="absolute top-2 left-2 opacity-0 transition-opacity duration-100 group-focus-within/tile:opacity-100 group-hover/tile:opacity-100">{topLeft}</div>
      )}
      {topRight && (
        <div className="absolute top-2 right-2 opacity-0 transition-opacity duration-100 group-focus-within/tile:opacity-100 group-hover/tile:opacity-100">{topRight}</div>
      )}
      {badge && <div className="pointer-events-none absolute top-2 right-2 transition-opacity group-hover/tile:opacity-0">{badge}</div>}
      <div className="mt-2 truncate text-[13px] leading-[18px] font-medium text-foreground">{caption}</div>
      {meta && <div className="truncate text-xs text-tertiary">{meta}</div>}
    </div>
  );
}
