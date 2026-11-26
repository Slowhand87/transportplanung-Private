import { db, getRole, json, num } from '../../../lib/server';

export const dynamic = 'force-dynamic';
const T = 'transport_preise';

export async function GET(req) {
  const role = getRole(req);
  if (!role) return json({ error: 'PIN falsch' }, 401);
  if (role === 'chauffeur') return json({ prices: [] });
  const { data, error } = await db().from(T).select('plz,ort,preis').order('plz');
  if (error) return json({ error: error.message }, 500);
  return json({ prices: data.map((p) => ({ ...p, preis: Number(p.preis) })) });
}

export async function POST(req) {
  if (getRole(req) !== 'buero') return json({ error: 'Nicht erlaubt' }, 403);
  const b = await req.json();
  const plz = String(b.plz || '').trim();
  const preis = num(b.preis);
  if (!plz || preis < 0) return json({ error: 'PLZ und Preis angeben' }, 400);
  const { error } = await db().from(T).upsert({ plz, ort: String(b.ort || '').trim() || null, preis }, { onConflict: 'plz' });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

export async function DELETE(req) {
  if (getRole(req) !== 'buero') return json({ error: 'Nicht erlaubt' }, 403);
  const plz = new URL(req.url).searchParams.get('plz');
  const { error } = await db().from(T).delete().eq('plz', plz);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
