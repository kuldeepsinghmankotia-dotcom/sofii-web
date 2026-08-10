-- WhatsApp channel: linking a phone number to an account, and not
-- answering the same message twice.
--
-- A webhook arrives with a phone number and nothing else — no session, no
-- cookie. Something has to say which Sofii account that number belongs to,
-- and it must be something the user proves rather than something the
-- sender claims, since a phone number in a payload is only as trustworthy
-- as the signature that carried it.

-- One WhatsApp number maps to exactly one account.
--
-- phone is the primary key rather than user_id: the lookup on every single
-- inbound message is "who is this number", and making that the key means
-- the hot path is a primary-key hit. It also enforces the rule that a
-- number cannot be linked to two accounts at once, which would make
-- delivery ambiguous.
create table public.whatsapp_links (
  -- E.164 without '+', exactly as Meta sends it (e.g. 919876543210).
  phone text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- WhatsApp profile name, purely for showing the user what they linked.
  display_name text,
  linked_at timestamptz not null default now()
);

-- A user might legitimately link several numbers (personal, work), so this
-- is not unique — but it is the index behind "show me my linked numbers".
create index idx_whatsapp_links_user on public.whatsapp_links (user_id);

alter table public.whatsapp_links enable row level security;

create policy "whatsapp_links_select_own" on public.whatsapp_links for select
  using (auth.uid() = user_id);

-- Users can unlink from the web app; linking happens server-side via the
-- webhook (service_role), because it requires proving control of the number.
create policy "whatsapp_links_delete_own" on public.whatsapp_links for delete
  using (auth.uid() = user_id);

grant select, delete on public.whatsapp_links to authenticated;
grant all on public.whatsapp_links to service_role;

-- Short-lived codes that prove someone controls both the account and the
-- phone.
--
-- The user is signed in on the web when the code is generated, then sends
-- it from the number they want to link. Possessing the code proves the
-- account; sending it from the number proves the number.
create table public.whatsapp_link_codes (
  code text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

create index idx_whatsapp_link_codes_user on public.whatsapp_link_codes (user_id);

alter table public.whatsapp_link_codes enable row level security;

-- A user may create and read their own codes. They may not read anyone
-- else's: a readable code from another account would be enough to attach
-- your number to it.
create policy "whatsapp_link_codes_insert_own" on public.whatsapp_link_codes for insert
  with check (auth.uid() = user_id);

create policy "whatsapp_link_codes_select_own" on public.whatsapp_link_codes for select
  using (auth.uid() = user_id);

grant select, insert on public.whatsapp_link_codes to authenticated;
grant all on public.whatsapp_link_codes to service_role;

-- Meta redelivers a webhook until it gets a 200, and will happily deliver
-- the same message more than once. Without this, a slow reply means the
-- user is answered twice and charged twice.
--
-- The message id is Meta's own, so it is the natural idempotency key.
create table public.whatsapp_processed_messages (
  message_id text primary key,
  processed_at timestamptz not null default now()
);

-- Only the webhook (service_role) ever touches this; no user-facing policy
-- exists, and RLS denies everyone else by default.
alter table public.whatsapp_processed_messages enable row level security;
revoke all on public.whatsapp_processed_messages from anon, authenticated;
grant all on public.whatsapp_processed_messages to service_role;

-- Which conversation a number's messages continue.
--
-- WhatsApp has no notion of separate threads, so all of a number's messages
-- belong to one rolling conversation. Storing it here keeps context across
-- messages instead of starting fresh every time, which is the whole point
-- of Sofii having memory.
alter table public.whatsapp_links
  add column conversation_id uuid references public.conversations (id) on delete set null;
