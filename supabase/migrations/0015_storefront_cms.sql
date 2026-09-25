-- Storefront CMS: every piece of customer-facing copy/imagery becomes admin-editable.
--
--  • page_content          — structured content blocks (trust badges, story, reels, about page,
--                            FAQs, policy pages, …). One row per block key; the value is JSON
--                            validated by the backend content catalog. A missing row means
--                            "use the catalog default", so this table starts empty.
--  • newsletter_subscribers — the footer / homepage newsletter signup (previously not stored).
--  • homepage_sections      — four previously fixed homepage sections become toggleable and
--                            reorderable, and section headings are now actually rendered.

create table if not exists page_content (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text,
  status text not null default 'subscribed' check (status in ('subscribed', 'unsubscribed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_newsletter_subscribers_email on newsletter_subscribers (lower(email));

drop trigger if exists set_newsletter_subscribers_updated_at on newsletter_subscribers;
create trigger set_newsletter_subscribers_updated_at before update on newsletter_subscribers
  for each row execute function public.set_updated_at();

-- Service-role (Express backend) only — no anon/authenticated policies.
alter table page_content enable row level security;
alter table newsletter_subscribers enable row level security;

-- Previously hardcoded homepage blocks, placed where they already render (between existing
-- sort orders). Enabled, so the live homepage looks exactly the same after this migration.
insert into homepage_sections (section_key, title, subtitle, description, button_text, button_url, sort_order, enabled) values
  ('trust_badges', null, null, null, null, null, 5, true),
  ('reels', 'See them *up close*', 'Suthrayaa reels', 'Short clips of our pieces — tap one to shop the collection.', 'Shop all', '/shop', 15, true),
  ('story', null, null, null, null, null, 25, true),
  ('convertible_showcase', null, null, null, null, null, 45, true)
on conflict (section_key) do nothing;

-- Headings are now rendered from these rows. Where a row still holds its original seed title,
-- copy in the storefront's current heading so nothing visibly changes (`*word*` = italic accent).
update homepage_sections set title = 'Shop by *category*', subtitle = coalesce(subtitle, 'Explore the collection'), button_text = coalesce(button_text, 'Browse all'), button_url = coalesce(button_url, '/shop')
  where section_key = 'featured_categories' and title = 'Shop by Category';
update homepage_sections set title = 'Featured *creations*', subtitle = coalesce(subtitle, 'Handpicked for you'), button_text = coalesce(button_text, 'View all products'), button_url = coalesce(button_url, '/shop')
  where section_key = 'featured_products' and title = 'Featured Products';
update homepage_sections set title = 'New *arrivals*', subtitle = coalesce(subtitle, 'Fresh off the hook'), button_text = coalesce(button_text, 'View all'), button_url = coalesce(button_url, '/shop?sort=newest')
  where section_key = 'new_arrivals' and title = 'New Arrivals';
update homepage_sections set title = 'Best *sellers*', subtitle = coalesce(subtitle, 'Customer favourites'), button_text = coalesce(button_text, 'View all best sellers'), button_url = coalesce(button_url, '/shop?sort=bestselling')
  where section_key = 'best_sellers' and title = 'Best Sellers';
update homepage_sections set title = 'Trending *now*', subtitle = coalesce(subtitle, 'Top rated this season'), button_text = coalesce(button_text, 'View all'), button_url = coalesce(button_url, '/shop?sort=rating')
  where section_key = 'trending' and title = 'Trending Now';
update homepage_sections set title = 'On *sale*', subtitle = coalesce(subtitle, 'Limited-time prices'), button_text = coalesce(button_text, 'Shop the sale'), button_url = coalesce(button_url, '/shop')
  where section_key = 'sale_products' and title = 'On Sale';
update homepage_sections set title = 'Our *collections*', subtitle = coalesce(subtitle, 'Curated for every corner')
  where section_key = 'collections' and title = 'Collections';
update homepage_sections set title = 'Loved by *our community*', subtitle = coalesce(subtitle, 'Kind words'), description = coalesce(description, 'Real stories from people who’ve gifted, cuddled and kept our handmade pieces.')
  where section_key = 'testimonials' and title = 'What Our Customers Say';
update homepage_sections set title = 'Made for sharing, *loved on Instagram*', subtitle = coalesce(subtitle, '@suthrayaa'), description = coalesce(description, 'Behind-the-scenes peeks, new drops and your beautiful photos — tag us to be featured.')
  where section_key = 'instagram' and title = 'Follow Us on Instagram';
update homepage_sections set title = 'Join the Suthrayaa circle', description = coalesce(description, 'New drops, maker stories and member-only offers — straight from our studio to your inbox. Get 10% off your first order.')
  where section_key = 'newsletter' and title = 'Stay in the Loop';

-- These four keys had no storefront component until now (they rendered nothing even when
-- enabled). They're built now, so start them switched off — turning one on is an admin choice.
update homepage_sections set enabled = false
  where section_key in ('trending', 'sale_products', 'collections', 'newsletter')
    and updated_at = created_at;

-- Branding colours are now applied to the storefront. Their old catalog defaults were a legacy
-- terracotta palette the site no longer uses; any row still holding one of those untouched
-- defaults is moved to the current theme so turning the feature on changes nothing visually.
update site_settings set value = to_jsonb(v.new_value), updated_at = now()
from (values
  ('branding.color_primary', '#c1502e', '#6d4aff'),
  ('branding.color_secondary', '#7c9473', '#ff9e7a'),
  ('branding.color_accent', '#d8a13b', '#f5b544'),
  ('branding.color_background', '#fbf6ee', '#fcfbff'),
  ('branding.color_text', '#3a2a1f', '#1f1a33'),
  ('branding.color_success', '#2fdc84', '#1e7a48'),
  ('branding.color_error', '#d64545', '#e5484d')
) as v(key, old_value, new_value)
where site_settings.key = v.key and site_settings.value = to_jsonb(v.old_value);

-- Footer links seeded to pages that never existed (404s): point them at real pages.
update footer_links set url = '/account/orders' where url = '/track-order';
update footer_links set url = '/#testimonials' where url = '/testimonials';
delete from footer_links where url = '/blog';
