-- GP Guardian — Foundational Schema (MVP, single-venue)
-- Matches design doc: gp-guardian-ingredient-matching-design.md (Parts A, B, C)

-- ─────────────────────────────────────────────
-- Venue (single row for MVP — multi-tenancy is a later phase)
-- ─────────────────────────────────────────────
create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_target_gp numeric not null default 70,
  currency text not null default 'GBP',
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- Part A — Ingredients & Matching
-- ─────────────────────────────────────────────
create table ingredients (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  canonical_name text not null,
  default_unit text not null check (default_unit in ('g', 'ml', 'unit')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  name text not null,
  active boolean not null default true
);

create table ingredient_aliases (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  raw_text text not null,
  supplier_id uuid references suppliers(id),
  match_type text not null check (match_type in ('exact', 'fuzzy_confirmed', 'manual')),
  created_at timestamptz not null default now(),
  unique (venue_id, raw_text, supplier_id)
);

create table supplier_products (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  ingredient_id uuid references ingredients(id),
  raw_product_name text not null,
  pack_count integer,
  unit_weight_min numeric,
  unit_weight_max numeric,
  unit text not null check (unit in ('g', 'kg', 'ml', 'l', 'unit')),
  observed_avg_weight numeric,
  observation_count integer not null default 0,
  latest_unit_price numeric,
  latest_price_date date
);

-- ─────────────────────────────────────────────
-- Documents (uploaded invoices / recipes — photo or PDF)
-- ─────────────────────────────────────────────
create table documents (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  document_type text not null check (document_type in ('invoice', 'recipe', 'menu')),
  file_url text not null,
  source_format text not null check (source_format in ('photo', 'pdf')),
  supplier_id uuid references suppliers(id),
  invoice_number text,
  invoice_date date,
  lines_detected integer not null default 0,
  lines_extracted integer not null default 0,
  lines_disregarded integer not null default 0,
  lines_verified integer not null default 0,
  review_status text not null default 'pending' check (review_status in ('pending', 'in_review', 'confirmed')),
  created_at timestamptz not null default now()
);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  supplier_id uuid references suppliers(id),
  supplier_product_id uuid references supplier_products(id),
  ingredient_id uuid references ingredients(id),
  product_name_raw text not null,
  pack_count integer,
  unit_weight_min numeric,
  unit_weight_max numeric,
  unit text not null check (unit in ('g', 'kg', 'ml', 'l', 'unit')),
  unit_price numeric,
  total_price numeric,
  invoice_number text,
  invoice_date date,
  is_estimated boolean not null default true,
  extraction_status text not null default 'extracted' check (extraction_status in ('extracted', 'low_confidence', 'unreadable')),
  match_confidence text check (match_confidence in ('high', 'medium', 'low', 'unmatched')),
  created_at timestamptz not null default now()
);

-- Duplicate invoice detection (Part A §5): same supplier + invoice number + date
-- can't be uploaded twice (e.g. goods-in photo + emailed PDF of the same invoice).
-- Only enforced where invoice_number is present — plenty of paper invoices won't have one.
create unique index idx_invoice_unique on documents (venue_id, supplier_id, invoice_number, invoice_date)
  where document_type = 'invoice' and invoice_number is not null;

-- ─────────────────────────────────────────────
-- Part B — Recipes & Costing
-- ─────────────────────────────────────────────
create table recipes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  name text not null,
  yield_quantity numeric,
  yield_unit text,
  portions integer not null default 1,
  target_gp numeric,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table recipe_lines (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid references ingredients(id),
  raw_text text not null,
  quantity numeric not null,
  unit text not null check (unit in ('g', 'ml', 'unit')),
  waste_percentage numeric not null default 0,
  match_confidence text check (match_confidence in ('high', 'medium', 'low', 'unmatched'))
);

-- ─────────────────────────────────────────────
-- Part C — Menu Items & GP Snapshots
-- ─────────────────────────────────────────────
create table menu_items (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  name text not null,
  selling_price numeric,
  recipe_id uuid references recipes(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table gp_snapshots (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  menu_item_id uuid references menu_items(id),
  recipe_id uuid references recipes(id),
  food_cost numeric,
  selling_price numeric,
  gp_percent numeric,
  target_gp numeric,
  recommended_price numeric,
  is_incomplete boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- Row Level Security — MVP baseline (single venue, authenticated users only)
-- Tighten to per-venue policies once multi-tenancy (Phase 2+) is added.
-- ─────────────────────────────────────────────
alter table venues enable row level security;
alter table ingredients enable row level security;
alter table suppliers enable row level security;
alter table ingredient_aliases enable row level security;
alter table supplier_products enable row level security;
alter table documents enable row level security;
alter table invoice_lines enable row level security;
alter table recipes enable row level security;
alter table recipe_lines enable row level security;
alter table menu_items enable row level security;
alter table gp_snapshots enable row level security;

create policy "authenticated read/write" on venues for all using (auth.role() = 'authenticated');
create policy "authenticated read/write" on ingredients for all using (auth.role() = 'authenticated');
create policy "authenticated read/write" on suppliers for all using (auth.role() = 'authenticated');
create policy "authenticated read/write" on ingredient_aliases for all using (auth.role() = 'authenticated');
create policy "authenticated read/write" on supplier_products for all using (auth.role() = 'authenticated');
create policy "authenticated read/write" on documents for all using (auth.role() = 'authenticated');
create policy "authenticated read/write" on invoice_lines for all using (auth.role() = 'authenticated');
create policy "authenticated read/write" on recipes for all using (auth.role() = 'authenticated');
create policy "authenticated read/write" on recipe_lines for all using (auth.role() = 'authenticated');
create policy "authenticated read/write" on menu_items for all using (auth.role() = 'authenticated');
create policy "authenticated read/write" on gp_snapshots for all using (auth.role() = 'authenticated');

-- Seed the single default venue for MVP
insert into venues (name, default_target_gp, currency) values ('My Kitchen', 70, 'GBP');
