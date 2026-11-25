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
