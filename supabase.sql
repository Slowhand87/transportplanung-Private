-- Tabelle für Transportaufträge
create table if not exists public.transport_auftraege (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_name text not null,
  street text not null,
  zip text not null,
  city text not null,
  phone text,
  wish_date text,
  load_info text,
  return_goods text,
  urgency text not null default 'normal' check (urgency in ('normal','eilig')),
  status text not null default 'offen' check (status in ('offen','eingeplant','abgelehnt','erledigt')),
  plan_date date,
  sort_order integer not null default 0,
  decline_reason text,
  decline_ack boolean not null default false,
  driver_note text,
  photo_url text,
  completed_at timestamptz
);

-- Zugriff nur über den Server (Service-Key). Ohne Policies ist die Tabelle für Fremde gesperrt.
alter table public.transport_auftraege enable row level security;

-- Foto-Speicher (öffentlich lesbar, Dateinamen sind nicht erratbar)
insert into storage.buckets (id, name, public)
values ('ablieferfotos', 'ablieferfotos', true)
on conflict (id) do nothing;
