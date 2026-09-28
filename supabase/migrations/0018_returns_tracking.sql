-- Courier tracking links and customer return / exchange requests. Additive.

-- A link the customer can open to follow the parcel — pasted by the admin from the courier
-- alongside the tracking number.
alter table orders add column if not exists tracking_url text;

-- One request per return/exchange. Money moves through the existing refund ledger
-- (order_refunds); `refund_id` links the refund that settled a return.
create table if not exists return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete set null,
  type text not null check (type in ('return', 'exchange')),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'received', 'refunded', 'exchanged', 'cancelled')),
  reason text not null check (reason in ('damaged', 'defective', 'wrong_item', 'not_as_described', 'changed_mind', 'size_or_fit', 'other')),
  details text,
  -- [{ orderItemId, quantity }] — which lines (and how many of each) are coming back
  items jsonb not null default '[]',
  admin_note text,
  refund_id uuid references order_refunds(id) on delete set null,
  resolved_by uuid references admin_users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_return_requests_order on return_requests(order_id);
create index if not exists idx_return_requests_status on return_requests(status, created_at desc);
-- At most one open request per order (a closed one can be followed by a new request)
create unique index if not exists return_requests_one_open_per_order
  on return_requests(order_id) where status in ('requested', 'approved', 'received');

drop trigger if exists set_return_requests_updated_at on return_requests;
create trigger set_return_requests_updated_at before update on return_requests
  for each row execute function public.set_updated_at();

-- Service-role (Express backend) only, like the rest of the order tables
alter table return_requests enable row level security;
