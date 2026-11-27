import { db, TABLE, FLEX_DAYS, ZK, getRole, json, esc, sendMail, computeTotals } from '../../../lib/server';

export const dynamic = 'force-dynamic';

const EDITABLE = ['customer_name', 'street', 'zip', 'city', 'phone', 'email', 'wish_day', 'date_mode', 'delivery_type', 'phone_avis', 'time_from', 'time_to', 'department', 'vehicle', 'subject', 'load_info', 'return_goods', 'urgency'];
const KASSE_FIELDS = ['customer_name', 'street', 'zip', 'city', 'phone', 'email', 'wish_day', 'date_mode', 'delivery_type', 'phone_avis'];
const CHAUFFEUR_FIELDS = ['customer_name', 'street', 'zip', 'city', 'phone', 'email', 'wish_day', 'time_from', 'time_to', 'department', 'vehicle', 'return_goods', 'subject'];

function clean(b, keys) {
  const r = {};
  for (const k of keys) {
    let v = b[k];
    if (typeof v === 'string') v = v.trim();
    if (k === 'phone_avis') v = !!v;
    else if (k === 'delivery_type') v = v === 'abholung' ? 'abholung' : 'transport';
    else if (k === 'urgency') v = v === 'eilig' ? 'eilig' : 'normal';
    else if (k === 'date_mode') v = v === 'flex' ? 'flex' : 'fix';
    else if (k === 'time_from' || k === 'time_to') v = /^\d{2}:\d{2}$/.test(v || '') ? v : null;
    else if (k === 'department') v = v || 'Gärtnerei';
    else if (k === 'vehicle') v = v || 'Gärtnereibus';
    else if (v === '' || v === undefined) v = null;
    r[k] = v;
  }
  return r;
}
const missing = (r) => (!r.customer_name || !r.street || !r.zip || !r.city ? 'Kundenname, Strasse, PLZ und Ort sind Pflicht' : null);

export async function GET(req) {
  const role = getRole(req);
  if (!role) return json({ error: 'PIN falsch' }, 401);
  let q = db().from(TABLE).select('*').order('sort_order').order('created_at').limit(500);
  if (role === 'chauffeur') q = q.in('status', ['offen', 'eingeplant']).eq('delivery_type', 'transport');
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  // Der Chauffeur sieht keine Preise und keine E-Mail-Adressen
  const orders =
    role === 'chauffeur'
      ? data.map((o) => ({ ...o, email: null, goods_total: null, transport_cost: null, items: (o.items || []).map(({ qty, name, note }) => ({ qty, name, note })) }))
      : data;
  return json({ role, orders });
}

export async function POST(req) {
  const role = getRole(req);
  if (!role) return json({ error: 'Nicht erlaubt' }, 403);
  const b = await req.json();
  const row = clean(b, role === 'kasse' ? KASSE_FIELDS : role === 'chauffeur' ? CHAUFFEUR_FIELDS : EDITABLE);
  if (role === 'chauffeur') { row.date_mode = 'fix'; row.delivery_type = 'transport'; }
  const m = missing(row);
  if (m) return json({ error: m }, 400);
  const sb = db();
  Object.assign(row, await computeTotals(sb, { items: b.items, delivery_type: row.delivery_type, zip: row.zip }));
  row.created_by = role;
  if (role !== 'buero') row.status = 'pendent';
  const { data, error } = await sb.from(TABLE).insert(row).select().single();
  if (error) return json({ error: error.message }, 500);
  return json({ order: data });
}

export async function PATCH(req) {
  const role = getRole(req);
  if (!role) return json({ error: 'PIN falsch' }, 401);
  if (role === 'kasse') return json({ error: 'Nicht erlaubt' }, 403);
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
        const { data: cur } = await sb.from(TABLE).select('wish_day,date_mode,status').eq('id', b.id).maybeSingle();
        if (!cur || !open.includes(cur.status)) return json({ error: 'Auftrag nicht mehr offen' }, 409);
        if (cur.wish_day) {
          if (cur.date_mode !== 'flex') return json({ error: 'Fix-Termin: Das Datum kann nicht geändert werden' }, 400);
          const diff = d ? Math.abs((Date.parse(d) - Date.parse(cur.wish_day)) / 86400000) : 99;
          if (!(diff <= FLEX_DAYS)) return json({ error: `Nur ± ${FLEX_DAYS} Tage vom Wunschdatum möglich` }, 400);
        }
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
        const row = clean(b.fields || {}, EDITABLE);
        const m = missing(row);
        if (m) return json({ error: m }, 400);
        Object.assign(row, await computeTotals(sb, { items: b.fields.items, delivery_type: row.delivery_type, zip: row.zip }));
        const { data: cur } = await sb.from(TABLE).select('wish_day,date_mode').eq('id', b.id).maybeSingle();
        if (cur && (cur.wish_day !== row.wish_day || cur.date_mode !== row.date_mode)) row.plan_date = null;
        return json({ order: await one(b.id, row) });
      }
      if (b.action === 'ack') return json({ order: await one(b.id, { decline_ack: true }) });
      if (b.action === 'reassign')
        return json({ order: await one(b.id, { status: 'offen', plan_date: null, decline_ack: true, decline_reason: null }) });
      if (b.action === 'zukauf') {
        const { data: cur } = await sb.from(TABLE).select('items').eq('id', b.id).maybeSingle();
        if (!cur) return json({ error: 'Auftrag nicht gefunden' }, 404);
        let hit = false;
        const items = (cur.items || []).map((i) => {
          if (i.id !== b.item_id) return i;
          hit = true;
          const n = { ...i };
          if (b.zk_status !== undefined) {
            if (!ZK.includes(b.zk_status)) throw new Error('Status ungültig');
            n.zk_status = b.zk_status;
          }
          if (b.supplier !== undefined) n.supplier = String(b.supplier || '').slice(0, 100);
          return n;
        });
        if (!hit) return json({ error: 'Artikel nicht gefunden' }, 404);
        return json({ order: await one(b.id, { items }) });
      }
      if (b.action === 'release') return json({ order: await one(b.id, { status: 'offen' }, ['pendent']) });
      if (b.action === 'finish')
        return json({ order: await one(b.id, { status: 'erledigt', completed_at: new Date().toISOString() }, ['pendent', 'offen']) });
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
