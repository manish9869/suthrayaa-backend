-- Order integrity: stock that can only be returned once, a refund ledger backed by real
-- gateway refunds, race-safe coupon limits, and COD orders counted as paid once delivered.
-- Additive, with backfills for existing rows.

-- 'partially_refunded' was offered by the admin UI but rejected by the status check.
do $$
declare con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'orders'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%pending_payment%'
  loop
    execute format('alter table orders drop constraint %I', con.conname);
  end loop;
end $$;
alter table orders add constraint orders_status_check
  check (status in ('pending_payment','confirmed','in_production','ready','shipped','delivered','cancelled','refunded','partially_refunded'));

-- True while this order is holding stock (COD: from placement; online: from payment capture).
-- Returning stock flips it back with a conditional update, so a cancel followed by a refund
-- (or two concurrent cancels) can never restore the same units twice.
alter table orders add column if not exists stock_committed boolean not null default false;
alter table orders add column if not exists refunded_amount numeric(10,2) not null default 0 check (refunded_amount >= 0);
alter table orders add column if not exists paid_at timestamptz;

update orders set stock_committed = true
where status not in ('cancelled', 'refunded')
  and (payment_method = 'cod' or payment_status in ('paid', 'partially_refunded'));

-- COD is collected on delivery — before this migration nothing marked it paid, so every COD
-- sale was missing from revenue.
update orders set payment_status = 'paid', paid_at = coalesce(paid_at, updated_at)
where payment_method = 'cod' and status = 'delivered' and payment_status = 'pending';

update orders set paid_at = coalesce(placed_at, updated_at)
where payment_status in ('paid', 'partially_refunded', 'refunded') and paid_at is null;

update orders set refunded_amount = total where payment_status = 'refunded' and refunded_amount = 0;

create table if not exists order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  -- 'razorpay' = refunded through the gateway; 'manual' = paid back outside it (COD, UPI)
  method text not null check (method in ('razorpay', 'manual')),
  razorpay_refund_id text unique,
  status text not null default 'processed' check (status in ('pending', 'processed', 'failed')),
  reason text,
  restocked boolean not null default false,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_refunds_order on order_refunds(order_id);
create index if not exists idx_order_refunds_created on order_refunds(created_at);
alter table order_refunds enable row level security;

-- Coupons: guests are limited by email, one redemption per order, and the global limit is
-- enforced by the increment itself rather than a separate read.
alter table coupon_redemptions add column if not exists customer_email text;
create index if not exists idx_coupon_redemptions_coupon_email on coupon_redemptions(coupon_id, lower(customer_email));
delete from coupon_redemptions a using coupon_redemptions b
  where a.coupon_id = b.coupon_id and a.order_id = b.order_id and a.created_at > b.created_at;
create unique index if not exists coupon_redemptions_coupon_order_uidx on coupon_redemptions(coupon_id, order_id);

create or replace function public.try_increment_coupon_uses(p_coupon_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  affected int;
begin
  update coupons set uses_count = uses_count + 1
  where id = p_coupon_id and (max_uses is null or uses_count < max_uses);
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

-- Report queries filter on these
create index if not exists idx_orders_placed on orders(placed_at);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_customer_profiles_created on customer_profiles(created_at);
