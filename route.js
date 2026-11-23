import { db, TABLE, getRole, json, esc, sendMail } from '../../../lib/server';

export const dynamic = 'force-dynamic';

const EDITABLE = ['customer_name', 'street', 'zip', 'city', 'phone', 'wish_date', 'load_info', 'return_goods', 'urgency'];

export async function GET(req) {
  const role = getRole(req);
  if (!role) return json({ error: 'PIN falsch' }, 401);
  let q = db().from(TABLE).select('*').order('sort_order').order('created_at').limit(500);
  if (role === 'chauffeur') q = q.in('status', ['offen', 'eingeplant']);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ role, orders: data });
}

export async function POST(req) {
  if (getRole(req) !== 'buero') return json({ error: 'Nicht erlaubt' }, 403);
  const b = await req.json();
  if (!b.customer_name?.trim()) return json({ error: 'Kundenname fehlt' }, 400);
  const row = {};
  EDITABLE.forEach((k) => (row[k] = typeof b[k] === 'string' ? b[k].trim() : b[k] ?? null));
  const { data, error } = await db().from(TABLE).insert(row).select().single();
  if (error) return json({ error: error.message }, 500);
  return json({ order: data });
}

export async function PATCH(req) {
  const role = getRole(req);
  if (!role) return json({ error: 'PIN falsch' }, 401);
  const b = await req.json();
  const sb = db();
  const open = ['offen', 'eingeplant'];
  const one = async (id, patch, onlyStatus) => {
    let q = sb.from(TABLE).update(patch).eq('id', id);
    if (onlyStatus) q = q.in('status', onlyStatus);
    const { data, error } = await q.select().maybeSingle();
    if (error) throw error;
    return data;
  };
  try {
    if (role === 'chauffeur') {
      if (b.action === 'plan') {
        const d = b.plan_date || null;
        const o = await one(b.id, { plan_date: d, status: d ? 'eingeplant' : 'offen', sort_order: 1000 }, open);
        return json({ order: o });
      }
      if (b.action === 'reorder') {
        await Promise.all((b.ids || []).map((id, i) => sb.from(TABLE).update({ sort_order: i }).eq('id', id)));
        return json({ ok: true });
      }
      if (b.action === 'decline') {
        if (!b.reason?.trim()) return json({ error: 'Bitte einen Grund angeben' }, 400);
        const o = await one(b.id, { status: 'abgelehnt', decline_reason: b.reason.trim(), decline_ack: false }, open);
        if (!o) return json({ error: 'Auftrag nicht mehr offen' }, 409);
        await sendMail(
          `ABGELEHNT: Transport ${o.customer_name}`,
          `<h2>Auftrag abgelehnt</h2><p><b>Kunde:</b> ${esc(o.customer_name)}<br><b>Adresse:</b> ${esc(o.street)}, ${esc(o.zip)} ${esc(o.city)}</p><p><b>Grund:</b> ${esc(o.decline_reason)}</p>`
        );
        return json({ order: o });
      }
      if (b.action === 'complete') {
        const o = await one(
          b.id,
          { status: 'erledigt', driver_note: b.note?.trim() || null, photo_url: b.photo_url || null, completed_at: new Date().toISOString() },
          open
        );
        if (!o) return json({ error: 'Auftrag nicht mehr offen' }, 409);
        await sendMail(
          `ERLEDIGT: Transport ${o.customer_name}`,
          `<h2>Auftrag erledigt</h2><p><b>Kunde:</b> ${esc(o.customer_name)}<br><b>Adresse:</b> ${esc(o.street)}, ${esc(o.zip)} ${esc(o.city)}</p>` +
            (o.driver_note ? `<p><b>Notiz:</b> ${esc(o.driver_note)}</p>` : '') +
            (o.photo_url ? `<p><a href="${esc(o.photo_url)}">Ablieferfoto ansehen</a></p>` : '<p>Kein Foto hochgeladen.</p>')
        );
        return json({ order: o });
      }
    } else {
      if (b.action === 'edit') {
        const patch = {};
        EDITABLE.forEach((k) => k in b.fields && (patch[k] = b.fields[k]));
        return json({ order: await one(b.id, patch) });
      }
      if (b.action === 'ack') return json({ order: await one(b.id, { decline_ack: true }) });
      if (b.action === 'reassign')
        return json({
          order: await one(b.id, { status: 'offen', plan_date: null, decline_ack: true, decline_reason: null }),
        });
    }
    return json({ error: 'Unbekannte Aktion' }, 400);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function DELETE(req) {
  if (getRole(req) !== 'buero') return json({ error: 'Nicht erlaubt' }, 403);
  const id = new URL(req.url).searchParams.get('id');
  const { error } = await db().from(TABLE).delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
