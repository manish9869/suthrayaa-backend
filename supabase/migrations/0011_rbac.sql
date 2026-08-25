-- Role-based access control: users -> roles -> permissions.
-- admin_users.role is left in place untouched; authorization now flows through
-- user_roles/role_permissions instead. Run scripts/migrate-admin-roles.ts after this
-- migration to backfill user_roles for existing admin_users rows.

alter table admin_users add column if not exists is_active boolean not null default true;

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text,
  is_system_role boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  resource text not null,
  action text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (role_id, permission_id)
);

create table if not exists user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references admin_users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (user_id, role_id)
);

-- Invite-based admin registration: a token (hashed — never store the plaintext) minted by
-- an existing admin, redeemed once at a URL that isn't linked anywhere in the app.
create table if not exists admin_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  invited_by uuid references admin_users(id) on delete set null,
  role_ids uuid[] not null default '{}',
  token_hash text unique not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references admin_users(id) on delete set null,
  action text not null,
  resource text not null,
  resource_id text,
  permission text,
  metadata jsonb not null default '{}',
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_roles_user_id on user_roles(user_id);
create index if not exists idx_user_roles_role_id on user_roles(role_id);
create index if not exists idx_role_permissions_role_id on role_permissions(role_id);
create index if not exists idx_role_permissions_permission_id on role_permissions(permission_id);
create index if not exists idx_permissions_slug on permissions(slug);
create index if not exists idx_roles_slug on roles(slug);
create index if not exists idx_admin_invites_email on admin_invites(email);
create index if not exists idx_audit_logs_user_id on audit_logs(user_id);
create index if not exists idx_audit_logs_created_at on audit_logs(created_at desc);

alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table user_roles enable row level security;
alter table admin_invites enable row level security;
alter table audit_logs enable row level security;
-- No policies, matching admin_users/site_settings/coupons above: these tables are only ever
-- touched by the backend's service-role client (RLS-bypassing), never by the anon/authenticated
-- Supabase key, so there is no client-safe policy to write.
