-- Customer account: a default billing address alongside the default shipping address, and
-- an optional separate billing address captured at checkout. Additive only.
alter table addresses add column if not exists is_default_billing boolean not null default false;
alter table orders add column if not exists billing_address jsonb;

-- Existing default shipping addresses become the default billing address too.
update addresses set is_default_billing = true where is_default and not exists (
  select 1 from addresses a2 where a2.customer_id = addresses.customer_id and a2.is_default_billing
);

-- Duplicate-submit protection: the checkout sends one idempotency key per attempt; a retry
-- (double click, network retry) returns the existing order instead of creating another.
alter table orders add column if not exists idempotency_key text;
create unique index if not exists orders_idempotency_key_uidx on orders(idempotency_key) where idempotency_key is not null;

-- One invoice per order (a concurrent download + checkout notification could race).
-- Keeps the earliest invoice if duplicates already exist.
delete from invoices a using invoices b where a.order_id = b.order_id and a.created_at > b.created_at;
create unique index if not exists invoices_order_id_uidx on invoices(order_id);

-- Integrity + lookup performance for customer pages
create index if not exists idx_order_items_order on order_items(order_id);
create index if not exists idx_order_status_history_order on order_status_history(order_id);
create index if not exists idx_orders_razorpay_order on orders(razorpay_order_id) where razorpay_order_id is not null;
create index if not exists idx_wishlist_customer on wishlist_items(customer_id);
create index if not exists idx_cart_items_customer on cart_items(customer_id);
