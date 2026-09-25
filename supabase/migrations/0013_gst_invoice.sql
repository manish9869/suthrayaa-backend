-- GST tax invoices: an HSN code per GST rate category (printed per line and in the invoice's
-- tax summary). Optional — B2C invoices of businesses under ₹5 crore turnover may omit it.
alter table tax_categories add column if not exists hsn_code text;
