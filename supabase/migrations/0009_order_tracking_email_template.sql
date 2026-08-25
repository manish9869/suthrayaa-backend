-- A dedicated "tracking number updated" template, separate from order_shipped, so admins can
-- notify a customer when tracking is added/changed without that implying a status transition.
insert into email_templates (type, subject, body_html) values
  ('order_tracking_updated', 'Tracking added for your order {{order_number}}',
   '<p>Hi {{customer_name}},</p><p>Tracking has been added for your order <strong>{{order_number}}</strong>.</p><p>Tracking number: <strong>{{tracking_number}}</strong></p><p>— {{store_name}}</p>')
on conflict (type) do nothing;
