-- Replaces the 2-level category tree from 0002 with the real 3-level taxonomy
-- (Category > Subcategory > Sub-subcategory). categories.parent_id is self-referencing,
-- so arbitrary depth already works with no further schema change.

-- Deactivate every pre-0004 category — both 0002's full tree (top-level and its
-- subcategories) and the original seed-from-legacy-data.ts top-levels — so they stop
-- showing in navigation. Nothing is hard-deleted; products get re-pointed to the new
-- tree below. Note: 0002's subcategory insert for slug 'keychains' collided with (and
-- silently reparented) the original top-level 'keychains' row via ON CONFLICT, so this
-- list is matched by slug alone, not restricted to parent_id is null.
update categories set is_active = false
where slug in (
  -- 0002 top-level
  'crochet-flowers', 'home-decor', 'accessories', 'bags-holders', 'devghar-collection',
  -- 0002 subcategories
  'sunflowers', 'lilies', 'hibiscus', 'flower-pots', 'door-decor', 'coasters', 'keychains',
  'hair-ties', 'hairbands', 'convertible-bottle-holders', 'crochet-haar-garlands',
  -- original seed-from-legacy-data.ts top-levels untouched by 0002
  'amigurumi', 'baby', 'custom'
);

-- ============================================================
-- Level 1: top-level categories
-- ============================================================

insert into categories (slug, name, sort_order, is_active) values
  ('flowers-floral', 'Flowers & Floral', 1, true),
  ('home-and-decor', 'Home & Décor', 2, true),
  ('accessories-v2', 'Accessories', 3, true),
  ('devghar-collection-v2', 'Devghar Collection', 4, true),
  ('kids-gifts', 'Kids & Gifts', 5, true),
  ('custom-special', 'Custom & Special', 6, true)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order, is_active = true, parent_id = null;

-- ============================================================
-- Level 2: subcategories
-- ============================================================

insert into categories (slug, name, parent_id, sort_order, is_active)
select v.slug, v.name, c.id, v.sort_order, true
from (values
  ('crochet-flowers-v2', 'Crochet Flowers', 'flowers-floral', 1),
  ('flower-pots-v2', 'Flower Pots', 'flowers-floral', 2),
  ('door-decor-v2', 'Door Décor', 'home-and-decor', 1),
  ('coasters-v2', 'Coasters', 'home-and-decor', 2),
  ('home-decor-v2', 'Home Décor', 'home-and-decor', 3),
  ('keychains-v2', 'Keychains', 'accessories-v2', 1),
  ('hair-accessories', 'Hair Accessories', 'accessories-v2', 2),
  ('bags-holders-v2', 'Bags & Holders', 'accessories-v2', 3),
  ('crochet-haar-garlands-v2', 'Crochet Haar / Garlands', 'devghar-collection-v2', 1),
  ('devghar-decor', 'Devghar Décor', 'devghar-collection-v2', 2),
  ('amigurumi-toys-v2', 'Amigurumi Toys', 'kids-gifts', 1),
  ('baby-collection-v2', 'Baby Collection', 'kids-gifts', 2),
  ('custom-orders-v2', 'Custom Orders', 'custom-special', 1)
) as v(slug, name, parent_slug, sort_order)
join categories c on c.slug = v.parent_slug and c.parent_id is null
on conflict (slug) do update set name = excluded.name, parent_id = excluded.parent_id, sort_order = excluded.sort_order, is_active = true;

-- ============================================================
-- Level 3: sub-subcategories (includes forward-looking placeholders the
-- storefront/admin can activate later — marked in the description, not hidden)
-- ============================================================

insert into categories (slug, name, description, parent_id, sort_order, is_active)
select v.slug, v.name, v.description, c.id, v.sort_order, true
from (values
  -- Crochet Flowers
  ('sunflowers-v2', 'Sunflowers', null, 'crochet-flowers-v2', 1),
  ('lilies-v2', 'Lilies', null, 'crochet-flowers-v2', 2),
  ('hibiscus-v2', 'Hibiscus', null, 'crochet-flowers-v2', 3),
  ('roses', 'Roses', 'Planned — not yet in production', 'crochet-flowers-v2', 4),
  ('tulips', 'Tulips', 'Planned — not yet in production', 'crochet-flowers-v2', 5),
  -- Flower Pots
  ('sunflower-pot', 'Sunflower Pot', null, 'flower-pots-v2', 1),
  ('mixed-flower-pot', 'Mixed Flower Pot', 'Planned — not yet in production', 'flower-pots-v2', 2),
  -- Door Décor
  ('floral-door-hanging', 'Floral Door Hanging', null, 'door-decor-v2', 1),
  ('traditional-toran', 'Traditional Toran', 'Planned — not yet in production', 'door-decor-v2', 2),
  ('name-door-decor', 'Name Door Décor', 'Planned — not yet in production', 'door-decor-v2', 3),
  -- Coasters
  ('flower-coasters', 'Flower Coasters', null, 'coasters-v2', 1),
  ('sunflower-coasters', 'Sunflower Coasters', 'Planned — not yet in production', 'coasters-v2', 2),
  ('coaster-sets', 'Coaster Sets', null, 'coasters-v2', 3),
  -- Home Décor
  ('wall-hangings', 'Wall Hangings', 'Planned — not yet in production', 'home-decor-v2', 1),
  ('table-decor', 'Table Décor', 'Planned — not yet in production', 'home-decor-v2', 2),
  -- Keychains
  ('flower-keychains', 'Flower Keychains', null, 'keychains-v2', 1),
  ('initial-keychains', 'Initial Keychains', 'Planned — not yet in production', 'keychains-v2', 2),
  ('mini-crochet-keychains', 'Mini Crochet Keychains', 'Planned — not yet in production', 'keychains-v2', 3),
  -- Hair Accessories
  ('hair-ties-v2', 'Hair Ties', null, 'hair-accessories', 1),
  ('hairbands-v2', 'Hairbands', null, 'hair-accessories', 2),
  ('crochet-clips', 'Crochet Clips', 'Planned — not yet in production', 'hair-accessories', 3),
  -- Bags & Holders
  ('convertible-bottle-holders-v2', 'Convertible Bottle Holders', null, 'bags-holders-v2', 1),
  ('bottle-bags', 'Bottle Bags', 'Planned — not yet in production', 'bags-holders-v2', 2),
  ('mini-sling-bags', 'Mini Sling Bags', 'Planned — not yet in production', 'bags-holders-v2', 3),
  -- Crochet Haar / Garlands
  ('sonchafa-haar', 'Sonchafa Haar', null, 'crochet-haar-garlands-v2', 1),
  ('sonchafa-jaswand-haar', 'Sonchafa & Jaswand Haar', null, 'crochet-haar-garlands-v2', 2),
  ('jaswand-haar', 'Jaswand Haar', 'Planned — not yet in production', 'crochet-haar-garlands-v2', 3),
  ('mixed-flower-haar', 'Mixed Flower Haar', 'Planned — not yet in production', 'crochet-haar-garlands-v2', 4),
  -- Devghar Décor
  ('crochet-toran', 'Crochet Toran', 'Planned — not yet in production', 'devghar-decor', 1),
  ('pooja-flower-set', 'Pooja Flower Set', 'Planned — not yet in production', 'devghar-decor', 2),
  ('decorative-mala', 'Decorative Mala', 'Planned — not yet in production', 'devghar-decor', 3),
  -- Amigurumi Toys
  ('teddy-bear', 'Teddy Bear', 'Planned — not yet in production', 'amigurumi-toys-v2', 1),
  ('bunny', 'Bunny', 'Planned — not yet in production', 'amigurumi-toys-v2', 2),
  ('bee', 'Bee', 'Planned — not yet in production', 'amigurumi-toys-v2', 3),
  -- Baby Collection
  ('baby-booties', 'Baby Booties', 'Planned — not yet in production', 'baby-collection-v2', 1),
  ('baby-rattle', 'Baby Rattle', 'Planned — not yet in production', 'baby-collection-v2', 2),
  ('baby-gift-set', 'Baby Gift Set', 'Planned — not yet in production', 'baby-collection-v2', 3),
  -- Custom Orders
  ('personalized-gifts', 'Personalized Gifts', 'Planned — not yet in production', 'custom-orders-v2', 1),
  ('made-to-order-products', 'Made-to-Order Products', 'Planned — not yet in production', 'custom-orders-v2', 2)
) as v(slug, name, description, parent_slug, sort_order)
join categories c on c.slug = v.parent_slug and c.parent_id is not null
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  parent_id = excluded.parent_id,
  sort_order = excluded.sort_order,
  is_active = true;

-- Re-point every product still assigned to a pre-0004 category (from the original
-- seed script or 0002's now-deactivated tree) onto the closest matching new
-- sub-subcategory, so nothing becomes orphaned under an inactive category.
update products p
set category_id = new_cat.id
from (values
  ('keychains', 'flower-keychains'),
  ('amigurumi', 'amigurumi-toys-v2'),
  ('home-decor', 'home-decor-v2'),
  ('baby', 'baby-collection-v2'),
  ('accessories', 'coaster-sets'),
  ('custom', 'custom-orders-v2'),
  ('seasonal', 'coaster-sets')
) as remap(old_slug, new_slug)
join categories old_cat on old_cat.slug = remap.old_slug
join categories new_cat on new_cat.slug = remap.new_slug
where p.category_id = old_cat.id;
