/**
 * The Studio: the owner's own workbench (library, docs, contacts, video and audio
 * editors). Nothing here calls Claude, so it all works while the team rests; what you
 * prepare here is what the team picks up next.
 *
 * Each page renders its own frame with <StudioShell> (title + line tabs), because the
 * library and docs open records in a side peek that sits beside the page column.
 */
export default function StudioLayout({ children }: LayoutProps<"/b/[id]/studio">) {
  return children;
}
