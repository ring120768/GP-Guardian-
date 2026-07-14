# GP Guardian — Project Brief for Claude Code

Read this before making changes. It captures decisions already made so you don't
re-derive or accidentally drift from them.

## What this is

A desktop-first kitchen GP (gross profit) tracker for a single independent restaurant.
Built by a former chef (beginner developer, ~4 months in) as a first commercial app.
The person mentoring the build (via Claude chat) has already done the product design —
your job is implementation, not re-scoping. If something in the design seems wrong,
flag it and ask rather than silently changing it.

**Full design spec:** `docs/design.md` — read this in full before building anything in
Parts A/B/C below. It has schemas, pseudocode, and the reasoning behind each decision.
This CLAUDE.md is a summary/index, not a replacement for it.

## Current state

Foundations are built:
- `supabase/migrations/0001_init.sql` — full schema, matches design doc exactly
- `src/lib/costing.ts` — pure costing/GP functions (pack weight resolution, recipe
  costing, GP%, recommended price, cost multiple) — tested logic, no DB calls
- `src/lib/supabase/` — browser + server clients
- `src/types/database.ts` — hand-written types matching the schema
- Auth (Supabase email/password) + middleware route protection
- Dashboard shell at `src/app/page.tsx` — placeholder cards, no real queries yet

**Not built yet, in this order:**
1. Document upload (photo + PDF, both first-class from day one) + Supabase Storage
2. AI extraction pipeline — invoice lines and recipe lines → structured JSON (see
   `docs/design.md` §2 and §9 for exact schemas)
3. Ingredient matching UI — the alias-learning loop (design doc §3)
4. Review/confirm UI — original document + extracted data side by side, never
   auto-finalize AI output
5. Recipe costing wired into the UI (the math already exists in `costing.ts`)
6. Menu pricing screen (design doc Part C §14) — cost shown, price typed by chef,
   never pre-filled

## Non-negotiable principles (from the design doc — do not violate these)

1. **Never guess on money.** If a line can't be matched or costed, mark it
   `is_incomplete` / `unmatched` and show what's missing — never fall back to an
   invented number so the UI "looks complete."
2. **AI extracts, human confirms.** No AI output becomes final without explicit
   confirmation. This applies to invoice lines, recipe lines, and ingredient matches.
3. **Recommended price is a suggestion, never a default.** `selling_price` is only
   ever set by explicit human input, never pre-filled or auto-written by a
   calculation.
4. **Aliases persist and compound.** Every chef confirmation of an ingredient match
   writes to `ingredient_aliases` so it's instant next time. Don't build a matching
   flow that re-asks for something already confirmed.
5. **Photo and PDF are equal first-class inputs**, not primary/fallback. Route PDFs
   through text-layer extraction first, OCR/vision as fallback; photos go straight
   to OCR/vision. Same output schema either way.
6. **Extraction % ≠ Verified %.** Track them separately on `documents` — extraction
   quality is a "reshoot the photo" signal, verification is a "review queue" signal.
   Don't conflate them into one progress bar.
7. **Single venue for now.** RLS policies are intentionally loose (any authenticated
   user, not per-venue) because there's one venue and one user. Don't build
   multi-tenant complexity until it's actually needed — but don't hardcode
   assumptions that make it painful to add later either (every table already has
   `venue_id`).

## Tech stack

Next.js 14 (App Router) + TypeScript + Tailwind + Supabase (Postgres, Auth, Storage).
AI extraction should call the Anthropic API directly (structured JSON output,
document/image input) — not yet implemented, `ANTHROPIC_API_KEY` is in `.env.example`
ready for it.

## Working style

- Keep vertical slices small and demoable — one document type working end-to-end
  before moving to the next, not all three extraction types half-built at once.
- This person is learning to code alongside building this. Prefer clear, well-commented
  code over clever abstractions. Explain non-obvious decisions in code comments, not
  just commit messages.
