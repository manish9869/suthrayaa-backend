-- Server-side search / filter / sort for the admin Orders and Customers lists (they used to
-- load 300 rows and filter in the browser, silently missing everything older). Additive.

-- "Custom order" = any line with personalization. Kept on the order so it can be filtered in
-- the database instead of by scanning order_items JSON.
alter table orders add column if not exists is_custom boolean not null default false;
update orders o set is_custom = true
where exists (
  select 1 from order_items i
  where i.order_id = o.id
    and (coalesce(jsonb_array_length(i.customizations), 0) > 0 or coalesce(i.custom_text, '') <> '')
);
create index if not exists idx_orders_is_custom on orders(is_custom) where is_custom;
create index if not exists idx_orders_total on orders(total);

-- One row per customer with their order stats, so the list can sort and filter on spend.
-- security_invoker: the view runs with the caller's rights, so RLS on orders/customer_profiles
-- still applies — anon/authenticated clients get nothing; only the backend's service role reads it.
create or replace view public.admin_customer_stats
with (security_invoker = true) as
select
  cp.id,
  cp.email,
  cp.phone,
  cp.first_name,
  cp.last_name,
  cp.marketing_opt_in,
  cp.created_at,
  coalesce(s.order_count, 0)::int as order_count,
  coalesce(s.total_spent, 0)::numeric(12,2) as total_spent,
  s.last_order_at
from customer_profiles cp
left join lateral (
  select
    count(*) filter (where o.payment_status in ('paid', 'partially_refunded', 'refunded')) as order_count,
    sum(o.total - o.refunded_amount) filter (where o.payment_status in ('paid', 'partially_refunded', 'refunded')) as total_spent,
    max(o.placed_at) as last_order_at
  from orders o
  where o.customer_id = cp.id
) s on true
where not exists (select 1 from admin_users a where a.id = cp.id);

revoke all on public.admin_customer_stats from anon, authenticated;
