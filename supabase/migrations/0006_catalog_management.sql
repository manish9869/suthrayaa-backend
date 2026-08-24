-- Foundation for full Admin Product + Category management. Purely additive: every new
-- column has a default that preserves current behavior, so existing products/categories/
-- storefront reads/checkout/orders keep working unchanged.

-- ============================================================
-- Categories: SEO + visibility controls
-- ============================================================

alter table categories
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists show_in_navigation boolean not null default true,
  add column if not exists show_on_homepage boolean not null default false,
  add column if not exists is_featured boolean not null default false;

-- Preserve current storefront behavior: today the navbar/shop filters show every active
-- category, and the homepage tiles show every active top-level category. Backfill the
-- new flags to match exactly, so this migration changes nothing visible on its own.
update categories set show_in_navigation = true where is_active = true;
update categories set show_on_homepage = true where is_active = true and parent_id is null;

-- ============================================================
-- Products: status, pricing, made-to-order, shipping, SEO
-- ============================================================

alter table products
  add column if not exists status text not null default 'active'
    check (status in ('draft', 'active', 'hidden', 'out_of_stock', 'archived')),
  add column if not exists product_type text not null default 'ready_to_ship'
    check (product_type in ('ready_to_ship', 'made_to_order', 'custom_order')),
  add column if not exists processing_min_days int check (processing_min_days is null or processing_min_days >= 0),
  add column if not exists processing_max_days int check (processing_max_days is null or processing_max_days >= 0),
  add column if not exists processing_message text,
  add column if not exists cost_price numeric(10, 2) check (cost_price is null or cost_price >= 0),
  add column if not exists is_taxable boolean not null default true,
  add column if not exists tax_class text,
  add column if not exists sale_price numeric(10, 2) check (sale_price is null or sale_price >= 0),
  add column if not exists sale_start_date timestamptz,
  add column if not exists sale_end_date timestamptz,
  add column if not exists allow_backorders boolean not null default false,
  add column if not exists continue_selling_when_out_of_stock boolean not null default false,
  add column if not exists track_inventory boolean not null default true,
  add column if not exists is_physical boolean not null default true,
  add column if not exists weight numeric(10, 3),
  add column if not exists length numeric(10, 2),
  add column if not exists width numeric(10, 2),
  add column if not exists height numeric(10, 2),
  add column if not exists free_shipping boolean not null default false,
  add column if not exists shipping_class text,
  add column if not exists local_pickup_available boolean not null default false,
  add column if not exists meta_title text,
  add column if not exists meta_description text,
  add column if not exists search_keywords text;

-- Backfill status from the existing is_active flag so nothing already-inactive silently reappears.
update products set status = 'archived' where is_active = false and status = 'active';

-- ============================================================
-- Multi-category assignment (products.category_id stays as the primary category for
-- every existing read path; this table adds the ability to also list a product under
-- additional categories without touching those paths).
-- ============================================================

create table if not exists product_categories (
  product_id uuid not null references products(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  is_primary boolean not null default false,
  primary key (product_id, category_id)
);
create index if not exists idx_product_categories_category on product_categories(category_id);

insert into product_categories (product_id, category_id, is_primary)
select id, category_id, true from products where category_id is not null
on conflict (product_id, category_id) do nothing;

-- ============================================================
-- Customization values: optional per-value SKU (bookkeeping only — stock stays
-- tracked at the product level, no separate variant-level inventory split).
-- ============================================================

alter table customization_values add column if not exists sku text;
create unique index if not exists idx_customization_values_sku on customization_values(sku) where sku is not null;

-- ============================================================
-- Duplicate-SKU protection (categories.slug is already unique from 0001).
-- ============================================================

create unique index if not exists idx_products_sku_unique on products(sku) where sku is not null;

-- ============================================================
-- Views: category product counts, updated to also honor is_featured/show flags
-- via the categories table directly (no view change needed — kept as-is).
-- ============================================================
