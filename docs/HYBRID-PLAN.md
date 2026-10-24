# Ajudan as a hybrid workspace: good for people, good for agents

Written 2026-10-24. Today Ajudan is laid out around the AI team (Chat, Office, Inbox, Work…), and the tools a person uses daily (Docs, Library, Contacts) sit behind Studio tabs. Documents live in four places (`context_pages`, `deliverables` as Work, `deliverables` as Studio Docs, raw `work/*.md`), nothing links to anything, tags exist only on assets and contacts, the library isn't in full-text search, and there's no trash or undo for what a teammate changed.

## Principle: one set of objects, two ways in

Every object (doc, asset, contact) has the same basics: title, tags, links, who made it (`"owner"` or `"teammate:<id>"`), history, trash. People reach it through the UI; teammates reach it through MCP tools with the same verbs (search, read, create, update, link, tag). New abilities ship in both at once.

Docs decision: **one Docs view over `context_pages` + `deliverables`**, no table merge.

## Phase 0: Navigation and quick wins
- Nav in two groups: **Workspace** (Home, Docs, Library, Contacts, Files) and **Team** (Chat, Office, Inbox, Team, Desk, Studio for the video/audio editors).
- Top-level routes `/b/[id]/docs`, `/b/[id]/library`, `/b/[id]/contacts`; old Studio URLs redirect.
- Home page (`/b/[id]/home`): recent, new from the team, pinned/starred, follow-ups due, pending approvals.
- Command palette create actions; "Ask a teammate" (`planTask`) on every doc, asset, contact.

## Phase 1: Shared foundations (schema)
- `links` table (any object ↔ any object, with `created_by`), backlinks everywhere.
- `deleted_at` soft delete on assets, contacts, context pages, deliverables; a Trash page.
- `created_by`/`updated_by` on assets, context pages, contacts, deliverables.
- `object_history` table: a snapshot per change with who made it; restore.
- `assets_fts` (trigram, like `drizzle/0020_search.sql`) so one search covers everything.
- `deliverables.folder`; contact `follow_up_at`/`follow_up_note` and `fields` (custom key/values).
- Per-collection agent access on the business: `read` | `suggest` | `write`.

## Phase 2: Each area good for people
- **Contacts:** contact page with a timeline (WhatsApp, tasks, deliverables, links), duplicate find/merge, vCard import, custom fields, follow-up reminders, saved segments.
- **Library:** drag-and-drop upload, smart albums (saved filters), teammate outputs (`work/images/…`) visible with a "from teammate" filter, "used in" backlinks.
- **Docs:** one view with source/status/folder filters, folders, templates, `@mentions` that create links, export (Markdown/HTML/print-to-PDF).

## Phase 3: Good for agents
- Tools: `search_workspace`, `search_docs`, `create_doc`, `link_objects`, `tag_objects`, `search_media`, `contact_timeline`, `log_interaction`, `set_follow_up`.
- Teammates edit their own objects; edits to the owner's objects become suggestions when access is `suggest`. Every teammate change goes into `object_history` and can be undone from the Inbox.
- Starred / pinned / curated items rank higher in tool results.

## Phase 4: Collaboration polish
- Activity/history side panel on every object; "New from the team" review queue (keep / edit / discard).
