-- Generalized, admin-controlled product customization engine.
-- Replaces the earlier rigid customization_rules/customization_allowed_colors model
-- (kept in place, unused, for products already seeded under it) with a normalized
-- option-groups + values design that supports arbitrary customization types,
-- per-value pricing, conditional reveal, and reusable templates.

alter table products add column if not exists customizable boolean not null default false;

-- ============================================================
-- Reusable templates (optional convenience — cloned into a product's own
-- customization + values on use, not live-linked)
-- ============================================================

create table if not exists customization_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('choice','color','text','number','checkbox')),
  created_at timestamptz not null default now()
);

create table if not exists customization_template_values (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references customization_templates(id) on delete cascade,
  label text not null,
  value text not null,
  price_adjustment numeric(10,2) not null default 0,
  sort_order int not null default 0
);
create index if not exists idx_template_values_template on customization_template_values(template_id);

-- ============================================================
-- Per-product customization groups + values
-- ============================================================

create table if not exists product_customizations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null,                          -- internal/admin name, e.g. "Size"
  label text not null,                          -- customer-facing label, e.g. "Choose Size"
  type text not null check (type in ('choice','color','text','number','checkbox')),
  required boolean not null default false,
  enabled boolean not null default true,
  sort_order int not null default 0,
  max_length int,                               -- text type only
  placeholder text,                             -- text type only
  default_value text,
  -- When set, this group is only shown to the customer once this specific value
  -- (from another group on the same product) has been selected — implements the
  -- "Add Name? Yes -> reveal Enter Name" conditional-reveal pattern generically.
  -- FK added below via ALTER TABLE since customization_values is created after this table.
  conditional_parent_value_id uuid,
  template_id uuid references customization_templates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_product_customizations_product on product_customizations(product_id);

create table if not exists customization_values (
  id uuid primary key default gen_random_uuid(),
  customization_id uuid not null references product_customizations(id) on delete cascade,
  label text not null,                          -- e.g. "Medium"
  value text not null,                          -- machine value, e.g. "medium"
  price_adjustment numeric(10,2) not null default 0,
  sort_order int not null default 0,
  enabled boolean not null default true
);
create index if not exists idx_customization_values_customization on customization_values(customization_id);

-- product_customizations.conditional_parent_value_id references customization_values,
-- which didn't exist yet when product_customizations was created above — add it now.
-- (Postgres has no ADD CONSTRAINT ... IF NOT EXISTS, so check pg_constraint manually.)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_product_customizations_conditional_value'
  ) then
    alter table product_customizations
      add constraint fk_product_customizations_conditional_value
      foreign key (conditional_parent_value_id) references customization_values(id) on delete set null;
  end if;
end $$;

drop trigger if exists set_product_customizations_updated_at on product_customizations;
create trigger set_product_customizations_updated_at before update on product_customizations
  for each row execute function public.set_updated_at();

-- ============================================================
-- Cart / order: store selections, and a full snapshot at order time
-- ============================================================

alter table cart_items add column if not exists customizations jsonb not null default '[]';

-- The original (customer_id, product_id, selected_color_hex, custom_text) unique
-- constraint from 0001 would spuriously collide once the new model leaves those two
-- columns blank for every line — two DIFFERENT customization selections on the same
-- product would both hash to (customer_id, product_id, '', '') and violate it. Drop it
-- (looked up dynamically since Postgres's auto-generated constraint name can vary/truncate)
-- and replace with a version that also differentiates on customizations.
do $$
declare
  c_name text;
begin
  select conname into c_name
  from pg_constraint
  where conrelid = 'cart_items'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) like '%selected_color_hex%custom_text%'
    and pg_get_constraintdef(oid) not like '%customizations%';

  if c_name is not null then
    execute format('alter table cart_items drop constraint %I', c_name);
  end if;
end $$;

create unique index if not exists idx_cart_items_unique_line
  on cart_items(customer_id, product_id, selected_color_hex, custom_text, customizations);

alter table order_items add column if not exists customizations jsonb not null default '[]';

-- ============================================================
-- RLS for the new tables
-- ============================================================

alter table product_customizations enable row level security;
alter table customization_values enable row level security;
alter table customization_templates enable row level security;
alter table customization_template_values enable row level security;

create policy "product_customizations_public_read" on product_customizations for select
  using (enabled = true and exists (select 1 from products p where p.id = product_customizations.product_id and p.is_active = true));

create policy "customization_values_public_read" on customization_values for select
  using (enabled = true and exists (
    select 1 from product_customizations pc
    join products p on p.id = pc.product_id
    where pc.id = customization_values.customization_id and pc.enabled = true and p.is_active = true
  ));

-- Templates are an admin-only authoring tool, never exposed to the storefront.
-- No policies on customization_templates / customization_template_values: default-deny
-- for anon/authenticated; only the service-role key (Express backend) can access them.
