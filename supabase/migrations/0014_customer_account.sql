-- Customer account: a default billing address alongside the default shipping address, and
-- an optional separate billing address captured at checkout. Additive only.
alter table addresses add column if not exists is_default_billing boolean not null default false;
alter table orders add column if not exists billing_address jsonb;

-- Existing default shipping addresses become the default billing address too.
update addresses set is_default_billing = true where is_default and not exists (
  select 1 from addresses a2 where a2.customer_id = addresses.customer_id and a2.is_default_billing
);
