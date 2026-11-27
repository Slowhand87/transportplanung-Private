import { getRole, json } from '../../../lib/server';

export const dynamic = 'force-dynamic';

// PLZ und Ort aus dem Internet (OpenPLZ API, Schweiz). Die Anfrage läuft über den Server.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function fetchPlaces(params) {
  const r = await fetch(`https://openplzapi.org/ch/Localities?${params}&pageSize=15`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

export async function GET(req) {
  if (!getRole(req)) return json({ error: 'PIN falsch' }, 401);
  const u = new URL(req.url);
  const plz = (u.searchParams.get('plz') || '').replace(/\D/g, '').slice(0, 4);
  const ort = (u.searchParams.get('ort') || '').trim().slice(0, 60);
  try {
    let rows = [];
    if (plz.length === 4) rows = await fetchPlaces(`postalCode=${plz}`);
    else if (ort.length >= 2) {
      const cap = ort.charAt(0).toUpperCase() + ort.slice(1);
      rows = await fetchPlaces(`name=${encodeURIComponent('^' + esc(cap))}`);
    }
    const seen = new Set();
    const places = [];
    for (const r of rows) {
      const key = `${r.postalCode}|${r.name}`;
      if (!r.postalCode || !r.name || seen.has(key)) continue;
      seen.add(key);
      places.push({ plz: String(r.postalCode), ort: r.name, kanton: r.canton?.shortName || r.canton?.code || '' });
    }
    return json({ places: places.slice(0, 10) });
  } catch {
    return json({ places: [] });
  }
}
