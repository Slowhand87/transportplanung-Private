-- Update für die Rolle «Kasse». Einmal im Supabase SQL Editor ausführen.

alter table public.transport_auftraege
  add column if not exists email text,
  add column if not exists delivery_type text not null default 'transport',
  add column if not exists phone_avis boolean not null default false,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists goods_total numeric,
  add column if not exists transport_cost numeric,
  add column if not exists created_by text not null default 'buero';

alter table public.transport_auftraege drop constraint if exists transport_auftraege_status_check;
alter table public.transport_auftraege add constraint transport_auftraege_status_check
  check (status in ('offen','eingeplant','abgelehnt','erledigt','pendent'));

alter table public.transport_auftraege drop constraint if exists transport_auftraege_delivery_check;
alter table public.transport_auftraege add constraint transport_auftraege_delivery_check
  check (delivery_type in ('abholung','transport'));

-- Transportpreise pro PLZ (werden im Büro gepflegt)
create table if not exists public.transport_preise (
  plz text primary key,
  ort text,
  preis numeric not null check (preis >= 0)
);
alter table public.transport_preise enable row level security;

grant usage on schema public to service_role;
grant all on table public.transport_auftraege to service_role;
grant all on table public.transport_preise to service_role;
