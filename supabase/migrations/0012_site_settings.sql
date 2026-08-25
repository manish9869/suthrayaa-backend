-- Site Settings module. The flat key/value settings store (site_settings) already exists
-- from 0001_init.sql and was never used — this migration only adds the genuinely relational
-- pieces (tax categories, shipping zones, nav/footer/homepage config) plus small additive
-- columns on existing tables. Nothing here changes existing behavior until the settings
-- service/seed populate site_settings and the app code starts reading it.

-- ============================================================
-- GST tax categories — replaces the free-text products.tax_class with a real rate table.
-- is_taxable/tax_class are left untouched (unused going forward, same as admin_users.role).
-- ============================================================

create table if not exists tax_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  rate numeric(5,2) not null check (rate >= 0 and rate <= 100),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table products add column if not exists tax_category_id uuid references tax_categories(id);

-- Safety net if this migration was already run once before this file was revised to add
-- `unique` above (create table if not exists silently skips the column defs on a re-run).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tax_categories_name_key') then
    alter table tax_categories add constraint tax_categories_name_key unique (name);
  end if;
end $$;

-- ============================================================
-- Shipping zones — state-grouped rates, replacing checkout.service.ts's hardcoded constants.
-- ============================================================

create table if not exists shipping_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  states text[] not null default '{}',
  pincodes text[] not null default '{}',
  shipping_fee numeric(10,2) not null default 0,
  free_shipping_threshold numeric(10,2),
  cod_available boolean not null default true,
  delivery_min_days int not null default 3,
  delivery_max_days int not null default 7,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shipping_zones_name_key') then
    alter table shipping_zones add constraint shipping_zones_name_key unique (name);
  end if;
end $$;

-- ============================================================
-- Indian address fields — landmark and district, alongside the existing city/state/pincode.
-- ============================================================

alter table addresses add column if not exists landmark text;
alter table addresses add column if not exists district text;
alter table addresses add column if not exists address_type text check (address_type in ('home', 'work', 'other'));

-- ============================================================
-- Order tax breakdown — additive, defaults to 0 so every existing order/order-creation
-- path is unaffected until GST is explicitly enabled in settings.
-- ============================================================

alter table orders add column if not exists tax_amount numeric(10,2) not null default 0;
alter table orders add column if not exists cgst_amount numeric(10,2) not null default 0;
alter table orders add column if not exists sgst_amount numeric(10,2) not null default 0;
alter table orders add column if not exists igst_amount numeric(10,2) not null default 0;

-- ============================================================
-- Navigation & footer — replaces navbar.tsx/footer.tsx's hardcoded link arrays.
-- ============================================================

create table if not exists nav_items (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  url text not null,
  parent_id uuid references nav_items(id) on delete cascade,
  icon text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  open_in_new_tab boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists footer_links (
  id uuid primary key default gen_random_uuid(),
  column_key text not null,
  label text not null,
  url text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Homepage section toggles/order/heading. Content for hero_banner/testimonials still comes
-- from the existing hero_slides/testimonials tables — this only controls whether a section
-- shows, in what order, and its heading copy.
-- ============================================================

create table if not exists homepage_sections (
  id uuid primary key default gen_random_uuid(),
  section_key text unique not null,
  enabled boolean not null default true,
  title text,
  subtitle text,
  description text,
  image_url text,
  button_text text,
  button_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- GST identity fields on the existing invoice_settings singleton — this is already "the
-- business's invoice identity," GST fields belong here rather than a parallel KV entry.
-- ============================================================

alter table invoice_settings add column if not exists is_gst_registered boolean not null default false;
alter table invoice_settings add column if not exists gstin text;
alter table invoice_settings add column if not exists gst_legal_name text;
alter table invoice_settings add column if not exists gst_state text;
alter table invoice_settings add column if not exists gst_state_code text;
alter table invoice_settings add column if not exists pan text;
alter table invoice_settings add column if not exists customer_gstin_optional boolean not null default true;

-- ============================================================
-- Configurable order-number prefix — safe, same atomicity (the upsert's row-level lock is
-- unchanged), only the literal prefix becomes a lookup instead of a hardcoded string.
-- Invoice numbers already read invoice_settings.invoice_prefix; this makes next_invoice_number
-- do the same instead of hardcoding 'INV'.
-- ============================================================

create or replace function next_order_number() returns text as $$
declare
  y int := extract(year from now())::int;
  v int;
  prefix text;
begin
  select value #>> '{}' into prefix from site_settings where key = 'order.number_prefix';
  if prefix is null or prefix = '' then prefix := 'ORD'; end if;

  insert into order_number_counters (year, last_value) values (y, 1)
  on conflict (year) do update set last_value = order_number_counters.last_value + 1
  returning last_value into v;
  return prefix || '-' || y || '-' || lpad(v::text, 4, '0');
end;
$$ language plpgsql;

create or replace function next_invoice_number() returns text as $$
declare
  y int := extract(year from now())::int;
  v int;
  prefix text;
begin
  select invoice_prefix into prefix from invoice_settings where id = 1;
  if prefix is null or prefix = '' then prefix := 'INV'; end if;

  insert into invoice_number_counters (year, last_value) values (y, 1)
  on conflict (year) do update set last_value = invoice_number_counters.last_value + 1
  returning last_value into v;
  return prefix || '-' || y || '-' || lpad(v::text, 4, '0');
end;
$$ language plpgsql;

-- ============================================================
-- Seed data — idempotent (on conflict do nothing), safe to re-run.
-- ============================================================

insert into tax_categories (name, rate, is_default) values
  ('GST 0%', 0, false),
  ('GST 5%', 5, false),
  ('GST 12%', 12, false),
  ('GST 18%', 18, true),
  ('GST 28%', 28, false)
on conflict (name) do nothing;

-- Matches checkout.service.ts's current hardcoded standard rate exactly — zero behavior
-- change until an admin edits this via the Shipping settings UI.
insert into shipping_zones (name, states, shipping_fee, delivery_min_days, delivery_max_days, sort_order) values
  ('Rest of India', '{}', 60, 4, 7, 100)
on conflict (name) do nothing;

insert into homepage_sections (section_key, title, sort_order) values
  ('hero_banner', null, 0),
  ('featured_categories', 'Shop by Category', 10),
  ('featured_products', 'Featured Products', 20),
  ('new_arrivals', 'New Arrivals', 30),
  ('best_sellers', 'Best Sellers', 40),
  ('trending', 'Trending Now', 50),
  ('sale_products', 'On Sale', 60),
  ('collections', 'Collections', 70),
  ('promotional_banner', null, 80),
  ('testimonials', 'What Our Customers Say', 90),
  ('instagram', 'Follow Us on Instagram', 100),
  ('newsletter', 'Stay in the Loop', 110)
on conflict (section_key) do nothing;

-- ============================================================
-- RLS — matching convention: enabled, no policies, service-role (backend) only. Public
-- reads go through dedicated Express routes (mirroring hero_slides/testimonials), not
-- direct anon/authenticated Supabase queries.
-- ============================================================

alter table tax_categories enable row level security;
alter table shipping_zones enable row level security;
alter table nav_items enable row level security;
alter table footer_links enable row level security;
alter table homepage_sections enable row level security;
