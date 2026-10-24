/**
 * The Studio: the owner's video and audio editors. Nothing here calls Claude, so it works
 * while the team rests. The library, docs and contacts moved to their own routes
 * (/b/[id]/library, /docs, /contacts); /studio, /studio/docs and /studio/contacts redirect.
 *
 * Each page renders its own frame with <StudioShell> (title + line tabs).
 */
export default function StudioLayout({ children }: LayoutProps<"/b/[id]/studio">) {
  return children;
}
