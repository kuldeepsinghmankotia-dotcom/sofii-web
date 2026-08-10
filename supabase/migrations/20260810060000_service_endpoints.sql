-- Where the Mac-hosted ingestion service can currently be reached.
--
-- Its public hostname comes from a Cloudflare *quick* tunnel, which gets a
-- brand-new random *.trycloudflare.com name every time cloudflared
-- restarts. That URL lived only in INGEST_SERVICE_URL, which meant every
-- restart silently broke all non-PDF uploads in production until someone
-- manually swapped a Vercel env var and redeployed. Worse, the breakage is
-- quiet: uploads just start failing, and nothing announces why.
--
-- Storing it here makes the address runtime state instead of build-time
-- config: the refresh script writes the new URL, and the very next request
-- picks it up with no env edit and no redeploy.
create table public.service_endpoints (
  -- Stable logical name of the service, not a surrogate id — there is
  -- exactly one row per service and callers look it up by name.
  key text primary key,
  url text not null,
  updated_at timestamptz not null default now()
);

alter table public.service_endpoints enable row level security;

-- Deliberately NO policy for authenticated/anon. This table is read only
-- by server-side code holding the service-role key (which bypasses RLS),
-- and the value is a URL the server sends INGEST_SERVICE_SECRET to — a
-- user who could write here could point that bearer token at a host they
-- control. Keeping every non-service_role role policy-less means RLS
-- denies them by default.
--
-- RLS alone is not sufficient in this project: without explicit grants
-- the anon/authenticated roles retain table privileges from the default
-- PUBLIC grant, so revoke them outright as well.
revoke all on public.service_endpoints from anon, authenticated;
grant all on public.service_endpoints to service_role;
