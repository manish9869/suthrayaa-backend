-- A customer-level (not order-level) template for manually welcoming a newly registered
-- customer — sent on demand from the admin's Customer detail page, not auto-fired on signup.
insert into email_templates (type, subject, body_html) values
  ('customer_welcome', 'Welcome to Suthrayaa, {{customer_name}}!',
   '<p>Hi {{customer_name}},</p><p>Welcome to Suthrayaa — we''re so glad you''re here. Every piece in our shop is handmade with care, and we can''t wait for you to find something you love.</p><p>— {{store_name}}</p>')
on conflict (type) do nothing;
