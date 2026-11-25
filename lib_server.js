import { createClient } from '@supabase/supabase-js';

export const TABLE = 'transport_auftraege';
export const BUCKET = 'ablieferfotos';

export const db = () =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

export function getRole(req) {
  const pin = req.headers.get('x-pin');
  if (!pin) return null;
  if (pin === process.env.BUERO_PIN) return 'buero';
  if (pin === process.env.CHAUFFEUR_PIN) return 'chauffeur';
  if (pin === process.env.KASSE_PIN) return 'kasse';
  return null;
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function sendMail(subject, html) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.MAIL_TO;
  if (!key || !to) return;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Transportplanung <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
      }),
    });
    if (!r.ok) console.error('Resend:', r.status, await r.text());
  } catch (e) {
    console.error('Resend-Fehler', e);
  }
}

export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round(n * 100) / 100;

// Berechnet Warenwert und Transportkosten auf dem Server (massgebend, nicht vom Browser übernommen)
export async function computeTotals(sb, { items, delivery_type, zip }) {
  const clean = (Array.isArray(items) ? items : [])
    .map((i) => ({
      qty: num(i.qty),
      name: String(i.name || '').trim().slice(0, 200),
      unit_price: num(i.unit_price),
      note: String(i.note || '').trim().slice(0, 500),
    }))
    .filter((i) => i.name);
  const goods_total = r2(clean.reduce((s, i) => s + i.qty * i.unit_price, 0));
  let transport_cost = 0;
  if (delivery_type !== 'abholung') {
    const { data } = await sb.from('transport_preise').select('preis').eq('plz', String(zip || '').trim()).maybeSingle();
    transport_cost = data ? Number(data.preis) : null;
  }
  return { items: clean, goods_total, transport_cost };
}
