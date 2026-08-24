-- Suthrayaa e-commerce schema
-- Run this in the Supabase SQL Editor (or via `supabase db push` once the project is linked).

create extension if not exists pgcrypto;

-- ============================================================
-- Catalog
-- ============================================================

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  image_url text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists colors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hex text not null,
  sort_order int not null default 0,
  is_active boolean not null default true
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text not null default '',
  short_description text not null default '',
  price numeric(10,2) not null check (price >= 0),
  compare_price numeric(10,2),
  category_id uuid references categories(id) on delete set null,
  tags text[] not null default '{}',
  stock int not null default 0 check (stock >= 0),
  low_stock_threshold int not null default 5,
  featured boolean not null default false,
  bestseller boolean not null default false,
  new_arrival boolean not null default false,
  is_active boolean not null default true,
  rating numeric(2,1) not null default 0,
  review_count int not null default 0,
  estimated_delivery text default '5-7 business days',
  dimensions text,
  materials text[] not null default '{}',
  care_instructions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_products_category on products(category_id);
create index if not exists idx_products_active on products(is_active);

create table if not exists product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  url text not null,
  alt_text text,
  sort_order int not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_product_images_product on product_images(product_id);

create table if not exists product_colors (
  product_id uuid not null references products(id) on delete cascade,
  color_id uuid not null references colors(id) on delete cascade,
  sort_order int not null default 0,
  primary key (product_id, color_id)
);

-- Admin-controlled customization: what a product allows beyond its base variants.
create table if not exists customization_rules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references products(id) on delete cascade,
  is_customizable boolean not null default false,
  allow_color_choice boolean not null default true,
  allow_text boolean not null default false,
  max_text_length int,
  text_placeholder text,
  allow_image_upload boolean not null default false,
  is_limited_edition boolean not null default false,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customization_allowed_colors (
  customization_rule_id uuid not null references customization_rules(id) on delete cascade,
  color_id uuid not null references colors(id) on delete cascade,
  primary key (customization_rule_id, color_id)
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  rating int not null check (rating between 1 and 5),
  title text,
  content text not null,
  images text[] not null default '{}',
  is_verified_purchase boolean not null default false,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_reviews_product on reviews(product_id);

create table if not exists testimonials (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  location text,
  content text not null,
  rating int not null check (rating between 1 and 5),
  avatar_url text,
  product_purchased text,
  is_published boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists hero_slides (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  description text,
  image_url text,
  cta_label text,
  cta_href text,
  accent_token text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- ============================================================
-- Customers
-- ============================================================

create table if not exists customer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  phone text,
  first_name text,
  last_name text,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  label text,
  first_name text not null,
  last_name text not null,
  phone text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  pincode text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_addresses_customer on addresses(customer_id);

create table if not exists admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin','admin','staff')),
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists cart_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity int not null default 1 check (quantity > 0),
  selected_color_hex text,
  selected_color_name text,
  custom_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, product_id, selected_color_hex, custom_text)
);

create table if not exists wishlist_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (customer_id, product_id)
);

-- ============================================================
-- Commerce
-- ============================================================

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  type text not null check (type in ('percent','flat')),
  value numeric(10,2) not null check (value > 0),
  min_subtotal numeric(10,2) not null default 0,
  max_uses int,
  uses_count int not null default 0,
  max_uses_per_customer int,
  starts_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  customer_id uuid references auth.users(id) on delete set null,
  guest_email text,
  guest_phone text,
  subtotal numeric(10,2) not null,
  discount_amount numeric(10,2) not null default 0,
  coupon_id uuid references coupons(id) on delete set null,
  shipping_cost numeric(10,2) not null default 0,
  gift_wrap_cost numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  currency text not null default 'INR',
  shipping_address jsonb not null,
  shipping_method text,
  payment_method text not null check (payment_method in ('cod','upi','card','razorpay')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded')),
  razorpay_order_id text,
  razorpay_payment_id text,
  status text not null default 'pending_payment' check (status in ('pending_payment','confirmed','in_production','shipped','delivered','cancelled','refunded')),
  gift_wrap boolean not null default false,
  gift_message text,
  placed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_orders_customer on orders(customer_id);
create index if not exists idx_orders_created on orders(created_at);
create index if not exists idx_orders_payment_status on orders(payment_status);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name_snapshot text not null,
  product_image_snapshot text,
  unit_price_snapshot numeric(10,2) not null,
  selected_color_hex text,
  selected_color_name text,
  custom_text text,
  quantity int not null check (quantity > 0),
  line_total numeric(10,2) not null
);
create index if not exists idx_order_items_order on order_items(order_id);
create index if not exists idx_order_items_product on order_items(product_id);

create table if not exists order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status text not null,
  note text,
  changed_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references coupons(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete set null,
  amount_discounted numeric(10,2) not null,
  created_at timestamptz not null default now()
);

-- Optional/forward-looking: lightweight event capture for a future conversion-funnel view.
create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  session_id text,
  customer_id uuid references auth.users(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_analytics_events_type on analytics_events(event_type);
create index if not exists idx_analytics_events_created on analytics_events(created_at);

-- ============================================================
-- Functions & triggers
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.customer_profiles (id, email, phone)
  values (new.id, new.email, new.phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.refresh_product_rating()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  target_product_id uuid;
begin
  target_product_id := coalesce(new.product_id, old.product_id);

  update products p
  set rating = coalesce((
        select round(avg(r.rating)::numeric, 1)
        from reviews r
        where r.product_id = target_product_id and r.is_published = true
      ), 0),
      review_count = (
        select count(*) from reviews r
        where r.product_id = target_product_id and r.is_published = true
      )
  where p.id = target_product_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists on_review_change on reviews;
create trigger on_review_change
  after insert or update or delete on reviews
  for each row execute function public.refresh_product_rating();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_products_updated_at on products;
create trigger set_products_updated_at before update on products
  for each row execute function public.set_updated_at();

drop trigger if exists set_orders_updated_at on orders;
create trigger set_orders_updated_at before update on orders
  for each row execute function public.set_updated_at();

drop trigger if exists set_customization_rules_updated_at on customization_rules;
create trigger set_customization_rules_updated_at before update on customization_rules
  for each row execute function public.set_updated_at();

drop trigger if exists set_customer_profiles_updated_at on customer_profiles;
create trigger set_customer_profiles_updated_at before update on customer_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_cart_items_updated_at on cart_items;
create trigger set_cart_items_updated_at before update on cart_items
  for each row execute function public.set_updated_at();

-- Atomic, race-safe stock adjustment — used by checkout instead of read-then-write from the app layer.
create or replace function public.decrement_product_stock(p_product_id uuid, p_qty int)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  affected int;
begin
  update products
  set stock = stock - p_qty
  where id = p_product_id and stock >= p_qty;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function public.increment_product_stock(p_product_id uuid, p_qty int)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update products set stock = stock + p_qty where id = p_product_id;
end;
$$;

create or replace function public.increment_coupon_uses(p_coupon_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update coupons set uses_count = uses_count + 1 where id = p_coupon_id;
end;
$$;

-- ============================================================
-- Views
-- ============================================================

create or replace view v_category_product_counts as
select c.id as category_id, c.slug, count(p.id) filter (where p.is_active) as product_count
from categories c
left join products p on p.category_id = c.id
group by c.id, c.slug;

create or replace view v_daily_sales as
select date_trunc('day', placed_at) as day,
       count(*) as order_count,
       sum(total) as revenue
from orders
where payment_status = 'paid'
group by 1
order by 1;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table categories enable row level security;
alter table colors enable row level security;
alter table products enable row level security;
alter table product_images enable row level security;
alter table product_colors enable row level security;
alter table customization_rules enable row level security;
alter table customization_allowed_colors enable row level security;
alter table reviews enable row level security;
alter table testimonials enable row level security;
alter table hero_slides enable row level security;
alter table site_settings enable row level security;
alter table customer_profiles enable row level security;
alter table addresses enable row level security;
alter table admin_users enable row level security;
alter table cart_items enable row level security;
alter table wishlist_items enable row level security;
alter table coupons enable row level security;
alter table coupon_redemptions enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_status_history enable row level security;
alter table analytics_events enable row level security;

-- Public catalog reads (only active/published rows)
create policy "categories_public_read" on categories for select using (is_active = true);
create policy "colors_public_read" on colors for select using (is_active = true);
create policy "products_public_read" on products for select using (is_active = true);

create policy "product_images_public_read" on product_images for select
  using (exists (select 1 from products p where p.id = product_images.product_id and p.is_active = true));

create policy "product_colors_public_read" on product_colors for select
  using (exists (select 1 from products p where p.id = product_colors.product_id and p.is_active = true));

create policy "customization_rules_public_read" on customization_rules for select
  using (exists (select 1 from products p where p.id = customization_rules.product_id and p.is_active = true));

create policy "customization_allowed_colors_public_read" on customization_allowed_colors for select
  using (exists (
    select 1 from customization_rules cr
    join products p on p.id = cr.product_id
    where cr.id = customization_allowed_colors.customization_rule_id and p.is_active = true
  ));

create policy "reviews_public_read" on reviews for select using (is_published = true);
create policy "reviews_customer_insert" on reviews for insert to authenticated
  with check (customer_id = auth.uid());

create policy "testimonials_public_read" on testimonials for select using (is_published = true);
create policy "hero_slides_public_read" on hero_slides for select using (is_active = true);

-- Customer-owned data
create policy "customer_profiles_self_select" on customer_profiles for select using (id = auth.uid());
create policy "customer_profiles_self_update" on customer_profiles for update using (id = auth.uid());

create policy "addresses_self_all" on addresses for all
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());

create policy "cart_items_self_all" on cart_items for all
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());

create policy "wishlist_items_self_all" on wishlist_items for all
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());

create policy "orders_self_read" on orders for select using (customer_id = auth.uid());

create policy "order_items_self_read" on order_items for select
  using (exists (select 1 from orders o where o.id = order_items.order_id and o.customer_id = auth.uid()));

create policy "order_status_history_self_read" on order_status_history for select
  using (exists (select 1 from orders o where o.id = order_status_history.order_id and o.customer_id = auth.uid()));

-- Write-only telemetry: anyone can insert, nobody but service_role can read.
create policy "analytics_events_insert" on analytics_events for insert to anon, authenticated with check (true);

-- No policies on site_settings, admin_users, coupons, coupon_redemptions:
-- default-deny for anon/authenticated. Only the service-role key (used exclusively by
-- the Express backend) bypasses RLS and can read/write these.
