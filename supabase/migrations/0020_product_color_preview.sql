-- Live color preview ("Customize & Preview"). A product can opt in to a preview that
-- repaints parts of the piece (petals, leaves, tassels...) as the customer picks colors in
-- its existing `color` customization groups. Two render modes:
--   photo — a base photo + one black/white mask per part, recolored in the browser
--   svg   — a built-in illustrated template (shipped as code) with named zones
-- Purely additive: preview_mode defaults to 'none', and the storefront only ever sees a
-- preview when the global `storefront.color_preview` setting is also on. Pricing, cart and
-- checkout validation keep flowing through the existing customization groups unchanged.

alter table products add column if not exists preview_mode text not null default 'none';
alter table products add column if not exists preview_svg_template text;
alter table products add column if not exists preview_base_url text;
alter table products add column if not exists preview_width int;
alter table products add column if not exists preview_height int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_preview_mode_check') then
    alter table products
      add constraint products_preview_mode_check check (preview_mode in ('none', 'photo', 'svg'));
  end if;
end $$;

-- One row per colorable part. customization_id links the part to the color group whose
-- chosen value paints it; cascading means deleting that group silently drops the layer.
create table if not exists product_preview_layers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  customization_id uuid not null references product_customizations(id) on delete cascade,
  zone text,                                    -- svg mode: template zone key, e.g. "petals"
  mask_url text,                                -- photo mode: black/white mask (white = this part)
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_product_preview_layers_product on product_preview_layers(product_id);

-- What the customer actually saw, frozen at order time so later edits to a product's
-- preview never change how a past order's work order renders for the admin.
alter table order_items add column if not exists preview_snapshot jsonb;

alter table product_preview_layers enable row level security;

drop policy if exists "product_preview_layers_public_read" on product_preview_layers;
create policy "product_preview_layers_public_read" on product_preview_layers for select
  using (exists (select 1 from products p where p.id = product_preview_layers.product_id and p.is_active = true));
