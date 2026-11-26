import { db, getRole, json } from '../../../lib/server';

export const dynamic = 'force-dynamic';
const T = 'fahrten';
const zurichDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
const guard = (req) => (getRole(req) === 'chauffeur' ? null : json({ error: 'Nicht erlaubt' }, 403));

export async function GET(req) {
  const g = guard(req);
  if (g) return g;
  const { data, error } = await db().from(T).select('*').order('day', { ascending: false }).order('started_at', { ascending: false }).limit(400);
  if (error) return json({ error: error.message }, 500);
  return json({ trips: data });
}

export async function POST(req) {
  const g = guard(req);
  if (g) return g;
  const b = await req.json();
  const sb = db();
  const { data: act } = await sb.from(T).select('*').is('ended_at', null).limit(1).maybeSingle();

  if (b.action === 'start') {
    if (act) return json({ trip: act });
    const { data, error } = await sb.from(T).insert({ day: zurichDay() }).select().single();
    if (error) return json({ error: error.message }, 500);
    return json({ trip: data });
  }
  if (b.action === 'end') {
    if (!act) return json({ error: 'Es läuft keine Fahrt' }, 400);
    const end = new Date();
    const minutes = Math.max(1, Math.round((end - new Date(act.started_at)) / 60000));
    const { data: done } = await sb
      .from('transport_auftraege')
      .select('customer_name,city,completed_at')
      .eq('status', 'erledigt')
      .gte('completed_at', act.started_at)
      .lte('completed_at', end.toISOString())
      .order('completed_at');
    const stops = (done || []).map((o) => [o.city, o.customer_name].filter(Boolean).join(': ')).join(', ');
    const { data, error } = await sb.from(T).update({ ended_at: end.toISOString(), minutes, stops }).eq('id', act.id).select().single();
    if (error) return json({ error: error.message }, 500);
    return json({ trip: data });
  }
  return json({ error: 'Unbekannte Aktion' }, 400);
}

export async function PATCH(req) {
  const g = guard(req);
  if (g) return g;
  const b = await req.json();
  const patch = {};
  if (b.minutes !== undefined) {
    const m = Math.round(Number(b.minutes));
    if (!(m >= 1 && m <= 1440)) return json({ error: 'Zeit muss zwischen 00:01 und 24:00 liegen' }, 400);
    patch.minutes = m;
  }
  if (b.stops !== undefined) patch.stops = String(b.stops).slice(0, 1000);
  const { error } = await db().from(T).update(patch).eq('id', b.id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

export async function DELETE(req) {
  const g = guard(req);
  if (g) return g;
  const id = new URL(req.url).searchParams.get('id');
  const { error } = await db().from(T).delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
