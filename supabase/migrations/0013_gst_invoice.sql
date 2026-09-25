-- GST tax invoices: an HSN code per GST rate category (printed per line and in the invoice's
-- tax summary). Optional — B2C invoices of businesses under ₹5 crore turnover may omit it.
alter table tax_categories add column if not exists hsn_code text;

-- Invoice design options (Invoice Settings page). Additive with defaults matching the
-- current layout, so existing invoices render exactly as before.
alter table invoice_settings add column if not exists tagline text not null default 'Handcrafted crochet, made to order';
alter table invoice_settings add column if not exists header_style text not null default 'dark';
alter table invoice_settings add column if not exists accent text not null default 'peach';
alter table invoice_settings add column if not exists show_hsn boolean not null default true;
alter table invoice_settings add column if not exists show_gst_summary boolean not null default true;
alter table invoice_settings add column if not exists show_amount_in_words boolean not null default true;
alter table invoice_settings add column if not exists show_payment boolean not null default true;
alter table invoice_settings add column if not exists show_signature boolean not null default true;
alter table invoice_settings add column if not exists signatory_name text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_settings_header_style_check') then
    alter table invoice_settings add constraint invoice_settings_header_style_check check (header_style in ('dark', 'light'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoice_settings_accent_check') then
    alter table invoice_settings add constraint invoice_settings_accent_check check (accent in ('peach', 'violet', 'rose', 'teal'));
  end if;
end $$;
