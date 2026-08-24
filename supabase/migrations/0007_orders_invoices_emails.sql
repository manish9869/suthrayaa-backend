-- Orders: Ready status, Partially Refunded payment status, courier/tracking/notes,
-- sequential order numbers. Invoices: numbered, snapshot-stable, on-demand PDF from
-- stored data. Emails: admin-editable templates + a log of every send attempt.
-- All additive — existing orders/checkout/emails keep working unchanged.

-- ============================================================
-- Orders: expand status sets, add fields admin can fill in
-- ============================================================

do $$
declare
  con record;
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
  check (status in ('pending_payment','confirmed','in_production','ready','shipped','delivered','cancelled','refunded'));

do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'orders'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%payment_status%' and pg_get_constraintdef(oid) like '%refunded%'
  loop
    execute format('alter table orders drop constraint %I', con.conname);
  end loop;
end $$;
alter table orders add constraint orders_payment_status_check
  check (payment_status in ('pending','paid','failed','refunded','partially_refunded'));

alter table orders
  add column if not exists tracking_number text,
  add column if not exists courier text,
  add column if not exists admin_notes text,
  add column if not exists customer_notes text;

-- Needed on invoices/order-detail so a line item's SKU stays correct even if the admin
-- later renames or reassigns the live product's SKU.
alter table order_items add column if not exists product_sku_snapshot text;

-- Sequential ORD-2026-0001 style numbers. Atomic under concurrent checkouts: the upsert's
-- row-level lock serializes concurrent callers for the same year.
create table if not exists order_number_counters (
  year int primary key,
  last_value int not null default 0
);

create or replace function next_order_number() returns text as $$
declare
  y int := extract(year from now())::int;
  v int;
begin
  insert into order_number_counters (year, last_value) values (y, 1)
  on conflict (year) do update set last_value = order_number_counters.last_value + 1
  returning last_value into v;
  return 'ORD-' || y || '-' || lpad(v::text, 4, '0');
end;
$$ language plpgsql;

-- ============================================================
-- Invoices: numbered, generated once at order placement, and stable afterward —
-- the snapshot freezes business/pricing details; payment/order status are read live.
-- ============================================================

create table if not exists invoice_number_counters (
  year int primary key,
  last_value int not null default 0
);

create or replace function next_invoice_number() returns text as $$
declare
  y int := extract(year from now())::int;
  v int;
begin
  insert into invoice_number_counters (year, last_value) values (y, 1)
  on conflict (year) do update set last_value = invoice_number_counters.last_value + 1
  returning last_value into v;
  return 'INV-' || y || '-' || lpad(v::text, 4, '0');
end;
$$ language plpgsql;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique not null,
  order_id uuid not null unique references orders(id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_invoices_order on invoices(order_id);

-- Singleton settings row (id is always 1 — enforced by the check, not just convention).
create table if not exists invoice_settings (
  id int primary key default 1 check (id = 1),
  business_name text not null default 'Suthrayaa',
  logo_url text,
  address text,
  email text,
  phone text,
  tax_number text,
  invoice_prefix text not null default 'INV',
  footer text not null default 'Thank you for supporting handmade.',
  terms text,
  currency text not null default 'INR',
  show_sku boolean not null default true,
  show_tax boolean not null default true,
  show_customization_pricing boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into invoice_settings (id) values (1) on conflict (id) do nothing;

-- ============================================================
-- Emails: admin-editable templates + a log of every send attempt
-- ============================================================

create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  type text unique not null,
  subject text not null,
  body_html text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists email_logs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  recipient text not null,
  order_id uuid references orders(id) on delete set null,
  subject text,
  body_html text,
  status text not null default 'pending' check (status in ('sent','failed','pending')),
  error_message text,
  sent_at timestamptz not null default now()
);
create index if not exists idx_email_logs_order on email_logs(order_id);
create index if not exists idx_email_logs_sent_at on email_logs(sent_at desc);

insert into email_templates (type, subject, body_html) values
  ('order_placed', 'We''ve received your order {{order_number}}!',
   '<p>Hi {{customer_name}},</p><p>Thank you for your order <strong>{{order_number}}</strong> placed on {{order_date}}, handcrafted with care.</p>{{items_table}}<h2 style="font-size:14px;margin:24px 0 8px;">Shipping to</h2>{{address_block}}<p>— {{store_name}}</p>'),
  ('order_confirmed', 'Your order {{order_number}} is confirmed',
   '<p>Hi {{customer_name}},</p><p>Your order <strong>{{order_number}}</strong> has been confirmed and will begin production soon.</p><p>— {{store_name}}</p>'),
  ('order_making', 'Your order {{order_number}} is being handmade',
   '<p>Hi {{customer_name}},</p><p>Great news — we''ve started making <strong>{{order_number}}</strong> by hand, just for you.</p><p>— {{store_name}}</p>'),
  ('order_ready', 'Your order {{order_number}} is ready',
   '<p>Hi {{customer_name}},</p><p>Your order <strong>{{order_number}}</strong> is finished and ready to ship.</p><p>— {{store_name}}</p>'),
  ('order_shipped', 'Your order {{order_number}} has shipped',
   '<p>Hi {{customer_name}},</p><p>Your order <strong>{{order_number}}</strong> is on its way! Tracking number: <strong>{{tracking_number}}</strong>.</p><p>— {{store_name}}</p>'),
  ('order_delivered', 'Your order {{order_number}} was delivered',
   '<p>Hi {{customer_name}},</p><p>Your order <strong>{{order_number}}</strong> has been delivered. We hope you love it!</p><p>— {{store_name}}</p>'),
  ('order_cancelled', 'Your order {{order_number}} was cancelled',
   '<p>Hi {{customer_name}},</p><p>Your order <strong>{{order_number}}</strong> has been cancelled. If this wasn''t expected, please reach out.</p><p>— {{store_name}}</p>'),
  ('payment_successful', 'Payment received for {{order_number}}',
   '<p>Hi {{customer_name}},</p><p>We''ve received your payment of <strong>{{order_total}}</strong> for order <strong>{{order_number}}</strong>.</p><p>— {{store_name}}</p>'),
  ('payment_failed', 'Payment failed for {{order_number}}',
   '<p>Hi {{customer_name}},</p><p>Your payment for order <strong>{{order_number}}</strong> could not be processed. Please try again.</p><p>— {{store_name}}</p>'),
  ('refund_processed', 'Refund processed for {{order_number}}',
   '<p>Hi {{customer_name}},</p><p>A refund for order <strong>{{order_number}}</strong> has been processed.</p><p>— {{store_name}}</p>'),
  ('custom_order_confirmation', 'Your custom order {{order_number}} is confirmed',
   '<p>Hi {{customer_name}},</p><p>We''ve received your custom order <strong>{{order_number}}</strong> and will begin working on it soon. We''ll keep you updated at every step.</p><p>— {{store_name}}</p>'),
  ('contact_enquiry_ack', 'We received your message', '<p>Hi {{customer_name}},</p><p>Thanks for reaching out — we''ll get back to you shortly.</p><p>— {{store_name}}</p>'),
  ('invoice_email', 'Your invoice {{invoice_number}} for order {{order_number}}',
   '<p>Hi {{customer_name}},</p><p>Please find attached the invoice <strong>{{invoice_number}}</strong> for order <strong>{{order_number}}</strong>.</p><p>— {{store_name}}</p>')
on conflict (type) do nothing;
