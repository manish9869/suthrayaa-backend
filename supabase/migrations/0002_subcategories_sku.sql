-- Adds two-level category hierarchy (parent_id) and a human-readable SKU per product,
-- per the real store taxonomy: Shop > Crochet Flowers/Home Décor/Accessories/Bags & Holders/
-- Devghar Collection > subcategories (e.g. Sunflowers, Door Décor, Keychains...).

alter table categories add column if not exists parent_id uuid references categories(id) on delete cascade;
create index if not exists idx_categories_parent on categories(parent_id);

alter table products add column if not exists sku text unique;
create index if not exists idx_products_sku on products(sku);

-- Subcategories inherit the public-read policy already defined on categories (is_active-scoped),
-- no new policy needed since it's the same table.

-- ============================================================
-- Real category taxonomy
-- ============================================================

insert into categories (slug, name, description, sort_order, is_active) values
  ('crochet-flowers', 'Crochet Flowers', 'Handcrafted crochet flowers for every occasion', 1, true),
  ('home-decor', 'Home Décor', 'Crochet pieces to adorn your living spaces', 2, true),
  ('accessories', 'Accessories', 'Keychains, hair ties, hairbands and more', 3, true),
  ('bags-holders', 'Bags & Holders', 'Functional handmade crochet carry pieces', 4, true),
  ('devghar-collection', 'Devghar Collection', 'Crochet pieces for your home temple', 5, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = true,
  parent_id = null;

insert into categories (slug, name, parent_id, sort_order, is_active)
select v.slug, v.name, c.id, v.sort_order, true
from (values
  ('sunflowers', 'Sunflowers', 'crochet-flowers', 1),
  ('lilies', 'Lilies', 'crochet-flowers', 2),
  ('hibiscus', 'Hibiscus', 'crochet-flowers', 3),
  ('flower-pots', 'Flower Pots', 'crochet-flowers', 4),
  ('door-decor', 'Door Décor', 'home-decor', 1),
  ('coasters', 'Coasters', 'home-decor', 2),
  ('keychains', 'Keychains', 'accessories', 1),
  ('hair-ties', 'Hair Ties', 'accessories', 2),
  ('hairbands', 'Hairbands', 'accessories', 3),
  ('convertible-bottle-holders', 'Convertible Bottle Holders', 'bags-holders', 1),
  ('crochet-haar-garlands', 'Crochet Haar / Garlands', 'devghar-collection', 1)
) as v(slug, name, parent_slug, sort_order)
join categories c on c.slug = v.parent_slug and c.parent_id is null
on conflict (slug) do update set
  name = excluded.name,
  parent_id = excluded.parent_id,
  sort_order = excluded.sort_order,
  is_active = true;
