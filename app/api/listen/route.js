import { db, getRole, json } from '../../../lib/server';

export const dynamic = 'force-dynamic';
const T = 'listen';
const KINDS = ['lieferant', 'gebinde', 'abteilung', 'fahrzeug'];

export async function GET(req) {
  const role = getRole(req);
  if (!role) return json({ error: 'PIN falsch' }, 401);
  const { data, error } = await db().from(T).select('id,kind,name').order('name');
  if (error) return json({ error: error.message }, 500);
  const lists = { lieferant: [], gebinde: [], abteilung: [], fahrzeug: [] };
  (data || []).forEach((r) => lists[r.kind]?.push({ id: r.id, name: r.name }));
  if (role !== 'buero') lists.lieferant = []; // Lieferanten sieht nur das Büro
  return json({ lists });
}

export async function POST(req) {
  if (getRole(req) !== 'buero') return json({ error: 'Nicht erlaubt' }, 403);
  const b = await req.json();
  const name = String(b.name || '').trim().slice(0, 100);
  if (!KINDS.includes(b.kind) || !name) return json({ error: 'Name fehlt' }, 400);
  const { error } = await db().from(T).insert({ kind: b.kind, name });
  if (error) return json({ error: error.code === '23505' ? 'Dieser Eintrag existiert bereits' : error.message }, 400);
  return json({ ok: true });
}

export async function DELETE(req) {
  if (getRole(req) !== 'buero') return json({ error: 'Nicht erlaubt' }, 403);
  const id = new URL(req.url).searchParams.get('id');
  const { error } = await db().from(T).delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
