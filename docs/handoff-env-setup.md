# Handoff prompt — GP Guardian end-to-end setup

Paste everything between the `---` markers into Hermes (or any agent). It is
self-contained: it assumes zero prior context about this project.

---

## Task

Get the GP Guardian app running end-to-end for the first time, and prove that a real
supplier invoice can be uploaded and read by the AI extraction pipeline.

The codebase is complete and compiles cleanly. Nothing has ever run against real
credentials. Your job is configuration and verification, **not** building features.

**Project root:** `/Users/ianring/Documents/Claude/Projects/gp-guardian`
**Stack:** Next.js 14 (App Router) + TypeScript + Tailwind + Supabase (Postgres, Auth,
Storage) + Anthropic API for invoice extraction.
**Package manager:** npm. Deps are already installed (`node_modules` present).

---

## Context you need

GP Guardian is a desktop-first kitchen gross-profit tracker for a single UK restaurant.
A chef photographs supplier invoices; the app extracts the line items with AI, the chef
confirms them, and the app costs recipes and tracks margin.

Two vertical slices are built and typecheck clean but have **never executed**:

1. **Document upload** — photo + PDF to a private Supabase Storage bucket.
2. **AI extraction** — Anthropic reads the invoice into schema-validated line items.

Read `CLAUDE.md` in the project root before doing anything. It contains non-negotiable
principles. The most important for you:

- **Never guess on money.** If something can't be read or matched, it must be flagged as
  incomplete, never filled with an invented number to make the UI look finished.
- **AI extracts, human confirms.** No AI output is ever final without explicit
  confirmation.
- This person is learning to code alongside building this. Prefer clear, commented code
  over clever abstractions, and explain non-obvious decisions.

Do not re-scope the product or refactor working code. If something in the design looks
wrong, flag it and ask rather than silently changing it.

---

## Steps

### 1. HUMAN GATE — ask the user to do these, you cannot

These need account access, 2FA, and billing. Ask for them up front, in one message, then
wait:

a. Create a Supabase project at supabase.com (free tier is fine). Region **London
   (eu-west-2)** — the venue is UK-based.
b. From **Project Settings → API**, send you the **Project URL** and the **anon/public**
   key.
c. From **Authentication → Users → Add user**, create a login user (email + password,
   tick "Auto Confirm User").
d. An **Anthropic API key** from console.anthropic.com (the account needs a few pounds of
   credit — extraction costs real money per invoice).
e. A photo or PDF of a **real supplier invoice** to test with. A creased, imperfect one
   from a phone camera is *better* than a clean one — that is the actual use case.

Do not proceed past this point without a, b, c and d.

### 2. Apply the database schema

The file `supabase/setup.sql` is the two migrations (`0001_init.sql` + `0002_documents_
processing_status.sql`) concatenated for a single paste. Ask the user to run it in the
Supabase **SQL Editor**.

It creates every table, RLS policy, a **private** `documents` storage bucket, and seeds
one venue called "My Kitchen".

**Known snag:** the `create policy ... on storage.objects` statements at the bottom may
fail with a permissions error ("must be owner of table objects") depending on the
Supabase SQL editor's role. If that happens, everything above it still succeeded — have
the user create the three storage policies via the dashboard UI instead (**Storage →
documents → Policies**), allowing INSERT, SELECT and DELETE for authenticated users. Do
not work around it by making the bucket public: invoices contain commercial pricing and
must not be world-readable.

Verify with a query that the tables exist and the venue row was seeded.

### 3. Create `.env.local`

Copy `.env.example` to `.env.local` and fill in the three values from step 1:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
```

`.env.local` is gitignored. **Never commit it, never echo the key values back in
full, and never paste them into a file that is tracked by git.**

### 4. Run and verify the happy path

```bash
npm run dev
```

Then walk the user through, and confirm each step actually works before moving on:

1. Visit `localhost:3000` — should redirect to `/login` (middleware protects routes).
2. Sign in with the user from step 1c — should land on the dashboard.
3. Click **Upload invoices** → the `/documents` page.
4. Drag in the real invoice from step 1e. Confirm it uploads and a card appears.
5. Click **Read invoice** on that card. This calls
   `POST /api/documents/[id]/extract`, which runs the Anthropic extraction.
6. Check the result in the Supabase table editor:
   - `documents` row: `processing_status` should be `extracted`, with sensible
     `lines_detected` / `lines_extracted` / `lines_disregarded` counts.
   - `invoice_lines`: one row per readable line, every one with
     `match_confidence = 'unmatched'` (nothing is auto-confirmed — that is by design).

### 5. Report back with evidence

State plainly what worked and what did not. Specifically:

- Did the extracted line items **match the actual paper invoice**? Compare a few
  products, pack sizes and prices by eye and say so honestly. This is the real test —
  "the API returned 200" is not the same as "it read the invoice correctly".
- Were any lines marked unreadable, and were they genuinely illegible on the original?
- Paste the actual counts and 2–3 example rows.

If extraction quality is poor, **do not tune the prompt yourself** — report what went
wrong with examples and let the user decide. The extraction prompt lives at
`src/lib/extraction/prompt.ts` and encodes deliberate product decisions.

---

## Known issues, so you don't chase them

- `npm run build` fails at the `/login` prerender step **only** when `.env.local` is
  absent. It resolves itself once real Supabase credentials exist. Not a code bug.
- `npm audit` shows a HIGH on `@supabase/auth-js` and a moderate on `postcss`. Both are
  known and deliberately deferred: fixing auth-js needs a coordinated `@supabase/ssr` +
  `supabase-js` upgrade, and those two are pinned exactly (`0.5.2` / `2.45.4`) because
  newer versions restructured their dist and broke the TypeScript types. **Do not run
  `npm audit fix --force`** — it will break the build.
- `getDocumentHealth()` in `src/lib/documents/health.ts` is an intentional stub. Document
  cards will show "Not wired up". The user is writing that function themselves as a
  learning exercise — **leave it alone**, do not implement it.

---

## Done when

- [ ] Schema applied; `venues` contains the seeded "My Kitchen" row
- [ ] `.env.local` exists with all three values, and is not tracked by git
- [ ] User can sign in and reach the dashboard
- [ ] A real invoice uploads successfully to the private bucket
- [ ] Extraction completes: `processing_status = 'extracted'`, `invoice_lines` populated
- [ ] Extracted values have been **eyeballed against the paper invoice** and the accuracy
      reported honestly, with examples

## Do NOT

- Do not implement `getDocumentHealth()` — it is the user's exercise
- Do not tune `src/lib/extraction/prompt.ts` — report quality problems instead
- Do not run `npm audit fix --force`
- Do not make the storage bucket public
- Do not commit `.env.local` or echo key values in full
- Do not build the next slices (ingredient matching, review UI) — this task is
  configuration and verification only

---
