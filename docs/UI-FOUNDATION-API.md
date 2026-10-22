# UI foundation API (Stream A) — what streams B–F build with

Every file below has a usage comment at its top; read it before using the component.

- `src/components/kit.tsx` (server-safe): `PageBody({width: "default"|"wide"|"full"})` (708/1100/1480px; adopting it drops the old padded frame), `PageHeader({icon?, title, description?, properties?: {label,value,icon?}[], actions?})`, `Section`, `PropertyList`, `LineTabs({items:{href,label,active,count?,icon?}[]})`, `Button` (primary/secondary/ghost/subtle/danger; default 32px, size="sm" 28px; `loading`), `IconButton({label, shortcut?})`, `Field({label, hint?, error?})`, `ConfirmDialog`, `Input`, `Textarea`, `Label`, `Kbd`, `Badge({tone: gray|brown|orange|yellow|green|blue|purple|pink|red})`, `tagClass`, `CountPill`, `StatusDot`, `Avatar({name,color,size,seed,status?})`, `Card`, `Prose`, `EmptyState({icon,title,body?,action?,compact?})`, skeletons `PageSkeleton|ListSkeleton|TableSkeleton|ChatSkeleton|EditorSkeleton|CardGridSkeleton`.
- `src/lib/status-tones.ts`: `statusTone(kind, status) -> {tone, label}`, `stateDot(state)`.
- `src/components/data-table.tsx`: `DataTable({rows, columns, getRowId, rowHref? | onRowOpen?, selectedId?, empty?, minWidth?})` (server pages pass `rowHref`), `DataTableToolbar`, `TableSearch`, `Gallery`, `GalleryTile`.
- `src/components/side-peek.tsx`: `SidePeekLayout({peek, children})`, `SidePeek({open,onClose,title?,openHref?,actions?})`, `useUrlPeek(param)` (caller must be inside `<Suspense>`), `useIsDesktop()`. Inline 420px pane ≥1024px, Sheet below.
- `src/components/breadcrumb.tsx`: `useBreadcrumb([{label, href?}])` / `<SetBreadcrumb items/>`; `<TopBarActions>` for top-bar buttons.
- `src/components/command-palette.tsx`: `useRegisterCommands([...])` / `<RegisterCommands commands/>`; `useCommandPalette()`.
- `src/components/shortcuts.tsx`: `useShortcut(keys, handler, opts)`, `isTypingTarget`, `useModKey`. Global: ⌘K, ⌘\, ⌘/, g+c/o/i/w/k/t.
- `src/app/b/[id]/nav.tsx`: `useSidebar()`.
- Search API `GET /api/b/[id]/search?q=` links to `context?page=`, `context/people?c=`, `deliverables?d=` (Stream D handles `?d=`), `teammates/<id>`.
- Toasts: `toast()` from "sonner" (Toaster mounted). i18n keys nav.*, palette.*, action.*, shortcuts.*, peek.*, table.* in common.ts; `messages/studio.ts` and `messages/desk.ts` are registered and empty.
- Notes for streams: palette/sidebar "New page" calls `createPageAction(businessId, "business", title)` (Stream C keeps it valid). "Give a task" goes to `?compose=1` on chat home (Stream B handles it). `--chrome-h` remains for chat until Stream B lands; chat roots may use `data-full-bleed`. `show-businesses-button.tsx` is unused (Stream F may delete). Old pixel utilities/colour aliases remain in globals.css until all streams finish.
