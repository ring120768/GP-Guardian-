# GP Guardian — Foundations

MVP scaffold: single-venue kitchen GP tracker. Matches the design doc
`gp-guardian-ingredient-matching-design.md` (Parts A, B, C).

## What's here

- **`supabase/migrations/0001_init.sql`** — full schema: ingredients, matching/aliases,
  invoices, recipes, menu items, GP snapshots. Seeds one default venue.
- **`src/lib/costing.ts`** — pure functions for pack-weight resolution, recipe costing,
  GP%, recommended price, cost multiple. No DB access — testable in isolation.
- **`src/lib/supabase/`** — browser + server Supabase clients.
- **`src/types/database.ts`** — hand-written types matching the schema.
- **Auth** — Supabase email/password, middleware-protected routes, login page.
- **`src/app/page.tsx`** — dashboard shell (placeholder cards, wire up real queries next).

## Setup

1. Create a free Supabase project at supabase.com.
2. Copy `.env.example` to `.env.local` and fill in your project URL + anon key
   (Supabase dashboard → Settings → API).
3. Run the migration: paste `supabase/migrations/0001_init.sql` into the Supabase
   SQL Editor and run it — or use the Supabase CLI (`supabase db push`) if you have
   it set up.
4. Create yourself a user: Supabase dashboard → Authentication → Add user.
5. Install and run:

```bash
npm install
npm run dev
```

6. Visit `localhost:3000`, sign in with the user you created.

## What's NOT built yet (by design — next slices)

- Document upload (photo/PDF) + storage
- AI extraction pipeline (invoice/recipe → structured JSON)
- Review/confirm UI (side-by-side original + extracted data)
- Ingredient matching UI (the alias-learning loop from Part A §3)
- Recipe → GP calculation wired into the UI (logic already exists in `costing.ts`)
- Menu pricing screen (Part C §14)

## Build order (recommended)

Follow the design doc's numbering: Part A first (get a real invoice scanning and
matching before touching recipes), then Part B (recipe costing), then Part C
(pricing screen). Each slice is independently testable before moving to the next.
