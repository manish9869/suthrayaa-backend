-- Generic customization regions. A product photo is divided into admin-defined regions
-- (each an arbitrary mask — the mask is the source of truth), optionally organised into
-- groups. Nothing here knows what a product is: names are informational only.
--
--   group  → shared_color = true  : one colour option recolours every region in it
--          → shared_color = false : one colour option per region, shown under the group
--   region → customization_id     : the colour option that paints it (null = fixed)
--          → region_type          : 'region' (customizable), 'fixed' (never recoloured),
--                                   'background' (the non-product area; one per product)
--   color_ids (group or region)    : allowed library colours; null = inherit
--                                    (region → group → product colours → whole library)
--
-- Purely additive and safe to re-run. Rows created before this migration keep working as
-- plain customizable regions.

create table if not exists product_preview_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null,
  shared_color boolean not null default true,
  color_ids uuid[],
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_product_preview_groups_product on product_preview_groups(product_id);

alter table product_preview_layers alter column customization_id drop not null;
alter table product_preview_layers add column if not exists name text;
alter table product_preview_layers add column if not exists region_type text not null default 'region';
alter table product_preview_layers add column if not exists group_id uuid references product_preview_groups(id) on delete set null;
alter table product_preview_layers add column if not exists color_ids uuid[];
alter table product_preview_layers add column if not exists allow_overlap boolean not null default false;
alter table product_preview_layers add column if not exists locked boolean not null default false;
alter table product_preview_layers add column if not exists hidden boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_preview_layers_region_type_check') then
    alter table product_preview_layers
      add constraint product_preview_layers_region_type_check check (region_type in ('region', 'fixed', 'background'));
  end if;
end $$;

-- Yarn library: colour family (for filtering) and an optional yarn code / SKU.
alter table colors add column if not exists family text;
alter table colors add column if not exists sku text;

-- Same access rules as layers: readable for active products; writes via the API only.
alter table product_preview_groups enable row level security;
drop policy if exists "product_preview_groups_public_read" on product_preview_groups;
create policy "product_preview_groups_public_read" on product_preview_groups for select
  using (exists (select 1 from products p where p.id = product_preview_groups.product_id and p.is_active = true));
