-- Competitel DB schema for Supabase
-- Run this in Supabase Dashboard > SQL Editor

-- competitors
create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  website_url text not null,
  product_url text default '',
  platform text default 'Other',
  check_frequency text default 'Daily',
  active boolean default true,
  created_at timestamptz default now()
);

-- products
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  price numeric(10,2),
  target_margin numeric(5,2),
  competitor_links jsonb default '[]',
  created_at timestamptz default now()
);

-- price_snapshots (one row per scrape run per competitor)
create table if not exists public.price_snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  results jsonb not null,
  scraped_at timestamptz default now()
);

-- analysis_results (one row per AI analysis run per competitor)
create table if not exists public.analysis_results (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  competitor_name text not null,
  analysis jsonb not null,
  current_prices jsonb,
  created_at timestamptz default now()
);

-- Row Level Security
alter table public.competitors enable row level security;
alter table public.products enable row level security;
alter table public.price_snapshots enable row level security;
alter table public.analysis_results enable row level security;

-- Policies: users own their data
create policy "users_competitors" on public.competitors for all using (auth.uid() = user_id);
create policy "users_products" on public.products for all using (auth.uid() = user_id);
create policy "users_snapshots" on public.price_snapshots for all using (
  competitor_id in (select id from public.competitors where user_id = auth.uid())
);
create policy "users_analysis" on public.analysis_results for all using (
  competitor_id in (select id from public.competitors where user_id = auth.uid())
);

-- Indexes for performance
create index if not exists idx_competitors_user on public.competitors(user_id);
create index if not exists idx_products_user on public.products(user_id);
create index if not exists idx_snapshots_competitor on public.price_snapshots(competitor_id, scraped_at desc);
create index if not exists idx_analysis_competitor on public.analysis_results(competitor_id, created_at desc);
