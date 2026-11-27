'use client';
import { useEffect, useState, useCallback, useRef } from 'react';

const addr = (o) => `${o.street}, ${o.zip} ${o.city}`;
const today = () => new Date().toLocaleDateString('sv-SE');
const STATUS = { offen: 'Offen', eingeplant: 'Eingeplant', abgelehnt: 'Abgelehnt', erledigt: 'Erledigt', pendent: 'Pendent' };
const ROLE_NAME = { buero: 'Büro', chauffeur: 'Chauffeur', kasse: 'Kasse' };
const TITLES = { buero: 'Transporte – Büro', chauffeur: 'Meine Touren', kasse: 'Kasse – Aufträge' };
const fmtDate = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric' }) : '');

async function api(pin, path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(path, {
    ...opts,
    headers: { 'x-pin': pin, ...(opts.body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw Object.assign(new Error('PIN falsch'), { code: 401 });
  if (!res.ok) throw new Error(data.error || 'Fehler');
  return data;
}
const send = (pin, method, body) => api(pin, '/api/orders', { method, body: JSON.stringify(body) });

async function compress(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.72));
}

export default function Home() {
  const [role, setRole] = useState(null);
  const [pin, setPin] = useState(null);

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('role');
    const ok = r === 'buero' || r === 'chauffeur' || r === 'kasse';
    setRole(ok ? r : 'none');
    setPin(ok ? localStorage.getItem('pin-' + r) : null);
  }, []);

  if (!role) return null;
  if (role === 'none')
    return (
      <main>
        <h1>Transportplanung</h1>
        <p>Bitte den Link mit Rolle öffnen:</p>
        <p><a href="/?role=buero">Büro</a> · <a href="/?role=chauffeur">Chauffeur</a> · <a href="/?role=kasse">Kasse</a></p>
      </main>
    );
  if (!pin) return <PinGate role={role} onOk={setPin} />;
  return <App role={role} pin={pin} onLogout={() => { localStorage.removeItem('pin-' + role); setPin(null); }} />;
}

function PinGate({ role, onOk }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  async function change(e) {
    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
    setV(val);
    setErr('');
    if (val.length === 4) {
      try {
        const r = await api(val, '/api/orders');
        if (r.role !== role) throw new Error('PIN gehört nicht zu dieser Ansicht');
        localStorage.setItem('pin-' + role, val);
        onOk(val);
      } catch (x) {
        setErr(x.message);
        setV('');
      }
    }
  }
  return (
    <main className="pin">
      <h1>{ROLE_NAME[role]}</h1>
      <label htmlFor="pin">PIN eingeben</label>
      <input id="pin" type="password" inputMode="numeric" autoComplete="off" autoFocus value={v} onChange={change} />
      {err && <p className="err">{err}</p>}
    </main>
  );
}

function AppInner({ role, pin, onLogout, onPrint }) {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [ios, setIos] = useState(false);
  const [prices, setPrices] = useState([]);
  const [lists, setLists] = useState({ lieferant: [], gebinde: [], abteilung: [], fahrzeug: [] });

  const reload = useCallback(async () => {
    try {
      const r = await api(pin, '/api/orders');
      setOrders(r.orders);
      if (role !== 'chauffeur') setPrices((await api(pin, '/api/prices')).prices);
      if (role !== 'kasse') setLists((await api(pin, '/api/listen')).lists);
      setError('');
    } catch (e) {
      if (e.code === 401) onLogout();
      else setError('Keine Verbindung – es wird weiter versucht.');
    }
  }, [pin, role, onLogout]);

  useEffect(() => {
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    reload();
    const t = setInterval(() => document.visibilityState === 'visible' && reload(), 5000);
    const v = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); };
  }, [reload]);

  return (
    <main>
      <div className="top">
        <h1>{TITLES[role]}</h1>
        <button className="ghost sm" onClick={onLogout}>Abmelden</button>
      </div>
      {error && <p className="err">{error}</p>}
      {role === 'buero' ? <Buero orders={orders} pin={pin} reload={reload} prices={prices} lists={lists} onPrint={onPrint} /> : role === 'kasse' ? <Kasse orders={orders} pin={pin} reload={reload} prices={prices} onPrint={onPrint} /> : <Chauffeur orders={orders} pin={pin} reload={reload} ios={ios} onPrint={onPrint} lists={lists} />}
    </main>
  );
}

/* ---------------- Gemeinsame Bausteine ---------------- */

const FIRMA = process.env.NEXT_PUBLIC_FIRMENNAME || 'Gärtnerei';
const FLEX_DAYS = 3;
const DEF_DEPT = 'Gärtnerei';
const DEF_VEH = 'Gärtnereibus';
const EMPTY = { customer_name: '', street: '', zip: '', city: '', phone: '', email: '', wish_day: '', date_mode: 'fix', delivery_type: 'transport', phone_avis: false, time_from: '', time_to: '', department: DEF_DEPT, vehicle: DEF_VEH, subject: '', load_info: '', return_goods: '', urgency: 'normal' };
const EMPTY_ITEM = { qty: '1', name: '', unit_price: '', note: '', zukauf: false };
const TIMES = Array.from({ length: 61 }, (_, i) => { const m = 300 + i * 15; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); });
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const chf = (n) => (n == null ? '–' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const LIEFER = { abholung: 'Abholung', transport: 'Transport' };
const ZK_LABEL = { zu_bestellen: 'zu bestellen', bestellt: 'bestellt', im_betrieb: 'im Betrieb', abgeschlossen: 'abgeschlossen' };
const wishText = (d, long) =>
  d.wish_day
    ? (long ? new Date(d.wish_day + 'T12:00:00').toLocaleDateString('de-CH') : fmtDate(d.wish_day)) + (d.date_mode === 'flex' ? ` (± ${FLEX_DAYS} Tage)` : ' (Fix-Termin)')
    : d.wish_date || '';
const parseRet = (s) => { const m = String(s || '').match(/^(\d+(?:[.,]\d+)?)\s*×\s*(.+)$/); return m ? { qty: m[1], name: m[2] } : { qty: '', name: s || '' }; };
const opts = (list, cur) => { const names = (list || []).map((x) => x.name); return cur && !names.includes(cur) ? [...names, cur] : names; };

function calc(f, prices) {
  const goods = f.items.reduce((s, i) => s + num(i.qty) * num(i.unit_price), 0);
  const p = prices.find((x) => x.plz === String(f.zip).trim());
  const transport = f.delivery_type === 'transport' ? (p ? Number(p.preis) : null) : 0;
  return { goods, transport, total: goods + (transport || 0), noPrice: f.delivery_type === 'transport' && !p };
}

// PLZ und Ort: Eingabe der einen Angabe füllt die andere automatisch (Daten aus dem Internet)
function PlzOrt({ pin, zip, city, patch }) {
  const [sugg, setSugg] = useState([]);
  const timer = useRef(null);
  const seq = useRef(0);

  const look = (query, onResult) => {
    clearTimeout(timer.current);
    const my = ++seq.current;
    timer.current = setTimeout(async () => {
      try {
        const r = await api(pin, '/api/plz?' + query);
        if (my === seq.current) onResult(r.places || []);
      } catch { if (my === seq.current) setSugg([]); }
    }, 350);
  };
  const pick = (p) => { seq.current++; patch({ zip: p.plz, city: p.ort }); setSugg([]); };
  const result = (list) => { if (list.length === 1) pick(list[0]); else setSugg(list); };

  const onZip = (e) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 4);
    patch({ zip: v });
    if (v.length === 4) look('plz=' + v, result); else { seq.current++; setSugg([]); }
  };
  const onCity = (e) => {
    const v = e.target.value;
    patch({ city: v });
    if (v.trim().length >= 2) look('ort=' + encodeURIComponent(v.trim()), result); else { seq.current++; setSugg([]); }
  };

  return (
    <>
      <div><label>PLZ *</label><input required inputMode="numeric" autoComplete="postal-code" value={zip} onChange={onZip} /></div>
      <div><label>Ort *</label><input required autoComplete="address-level2" value={city} onChange={onCity} /></div>
      {sugg.length > 0 && (
        <div className="full sugg" role="listbox" aria-label="Vorschläge für PLZ und Ort">
          {sugg.map((p) => <button type="button" key={p.plz + p.ort} className="ghost sm" onClick={() => pick(p)}>{p.plz} {p.ort}{p.kanton ? ` (${p.kanton})` : ''}</button>)}
          <button type="button" className="sm sugg-x" onClick={() => setSugg([])}>Vorschläge schliessen</button>
        </div>
      )}
    </>
  );
}

function OrderForm({ init, role, pin, lists, prices, saving, onSave, onCancel, onPrint }) {
  const L = lists || { gebinde: [], abteilung: [], fahrzeug: [] };
  const [f, setF] = useState(() => ({
    ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, init?.[k] ?? EMPTY[k]])),
    id: init?.id,
    items: (init?.items?.length ? init.items : [EMPTY_ITEM]).map((i) => ({ ...i, qty: String(i.qty ?? ''), unit_price: String(i.unit_price ?? ''), note: i.note || '' })),
  }));
  const patch = (p) => setF((x) => ({ ...x, ...p }));
  const set = (k) => (e) => patch({ [k]: e.target.value });
  const setItem = (i, k, v) => setF((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));
  const isB = role === 'buero', isK = role === 'kasse', isC = role === 'chauffeur';
  const c = calc(f, prices || []);
  const isT = f.delivery_type === 'transport';
  const ret = parseRet(f.return_goods);
  const setRet = (name, qty) => patch({ return_goods: name ? (qty ? `${qty} × ${name}` : name) : '' });
  const payload = () => ({
    ...f,
    items: isC ? [] : f.items.map((i) => ({ id: i.id, qty: num(i.qty), name: i.name, unit_price: num(i.unit_price), note: i.note, zukauf: !!i.zukauf, zk_status: i.zk_status, supplier: i.supplier })),
  });
  const submit = (e) => {
    e.preventDefault();
    if (f.time_from && f.time_to && f.time_to <= f.time_from) { alert('Die Zeit «bis» muss nach «von» liegen.'); return; }
    onSave(payload());
  };
  const timeSel = (k) => (
    <select value={f[k]} onChange={set(k)}><option value="">–</option>{TIMES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
  );
  const sw = (on, label, onClick) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={'switch' + (on ? ' right' : '')} onClick={onClick}><i /></button>
  );

  return (
    <form onSubmit={submit}>
      <div className="card">
        <h3>Kundendaten</h3>
        <div className="grid">
          <div className="full"><label>Kundenname *</label><input required value={f.customer_name} onChange={set('customer_name')} /></div>
          <div className="full"><label>Strasse und Nr. *</label><input required value={f.street} onChange={set('street')} /></div>
          <PlzOrt pin={pin} zip={f.zip} city={f.city} patch={patch} />
          <div><label>Telefon Kunde</label><input type="tel" value={f.phone} onChange={set('phone')} /></div>
          <div><label>E-Mail</label><input type="email" value={f.email} onChange={set('email')} /></div>
        </div>
      </div>

      <div className="card">
        <h3>Lieferung</h3>
        <div className="grid">
          <div><label>{isC ? 'Datum' : 'Wunschdatum'}</label><input type="date" value={f.wish_day} onChange={set('wish_day')} /></div>
          {!isC && (
            <div>
              <label>Termin</label>
              <div className="switchrow">
                <span className={f.date_mode === 'fix' ? 'on' : ''}>Fix-Termin</span>
                {sw(f.date_mode === 'flex', 'Zwischen Fix-Termin und Toleranz in Tagen umschalten', () => patch({ date_mode: f.date_mode === 'flex' ? 'fix' : 'flex' }))}
                <span className={f.date_mode === 'flex' ? 'on' : ''}>± {FLEX_DAYS} Tage</span>
              </div>
            </div>
          )}
          {!isC && (
            <>
              <div>
                <label>Abholung oder Transport</label>
                <div className="switchrow">
                  <span className={!isT ? 'on' : ''}>Abholung</span>
                  {sw(isT, 'Zwischen Abholung und Transport umschalten', () => patch({ delivery_type: isT ? 'abholung' : 'transport' }))}
                  <span className={isT ? 'on' : ''}>Transport</span>
                </div>
              </div>
              <div>
                <label>Telefon-Avis</label>
                <select value={f.phone_avis ? 'ja' : 'nein'} onChange={(e) => patch({ phone_avis: e.target.value === 'ja' })}>
                  <option value="nein">Nein</option><option value="ja">Ja</option>
                </select>
              </div>
            </>
          )}
          {!isK && (
            <>
              <div><label>Zeit von</label>{timeSel('time_from')}</div>
              <div><label>Zeit bis</label>{timeSel('time_to')}</div>
              <div><label>Abteilung</label>
                <select value={f.department} onChange={set('department')}>{opts(L.abteilung, f.department).map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
              <div><label>Fahrzeug</label>
                <select value={f.vehicle} onChange={set('vehicle')}>{opts(L.fahrzeug, f.vehicle).map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
              <div className="full"><label>Transportbetreff</label><input value={f.subject} onChange={set('subject')} /></div>
              {isB && <div className="full"><label>Ladung und Besonderheiten (für den Chauffeur)</label><textarea placeholder="Kran/Hebebühne, Ablageort …" value={f.load_info} onChange={set('load_info')} /></div>}
              <div className="full">
                <label>Leergut / Retouren mitnehmen</label>
                <div className="row">
                  <select style={{ flex: 1, minWidth: 150 }} value={ret.name} onChange={(e) => setRet(e.target.value, ret.qty || '1')}>
                    <option value="">– kein Leergut –</option>
                    {opts(L.gebinde, ret.name).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <input style={{ width: 90 }} inputMode="decimal" placeholder="Anzahl" aria-label="Anzahl Leergut" disabled={!ret.name} value={ret.qty} onChange={(e) => setRet(ret.name, e.target.value)} />
                </div>
              </div>
              {isB && <div><label>Dringlichkeit</label><select value={f.urgency} onChange={set('urgency')}><option value="normal">Normal</option><option value="eilig">Eilig</option></select></div>}
            </>
          )}
        </div>
      </div>

      {!isC && (
        <div className="card">
          <h3>Ware</h3>
          {f.items.map((it, i) => (
            <div className="item" key={i}>
              <div><label>Menge</label><input inputMode="decimal" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} /></div>
              <div><label>Artikel</label><input value={it.name} onChange={(e) => setItem(i, 'name', e.target.value)} /></div>
              <div><label>Einzelpreis CHF</label><input inputMode="decimal" value={it.unit_price} onChange={(e) => setItem(i, 'unit_price', e.target.value)} /></div>
              <div><label>Total CHF</label><div className="ro">{chf(num(it.qty) * num(it.unit_price))}</div></div>
              {isB && (
                <div className="note switchrow">
                  {sw(!!it.zukauf, 'Zukauf, nicht lagernd', () => setItem(i, 'zukauf', !it.zukauf))}
                  <span className={it.zukauf ? 'on' : ''}>Zukauf, nicht lagernd</span>
                </div>
              )}
              <details className="note notebox">
                <summary>Bemerkung{it.note ? ': ' + it.note.slice(0, 40) : ''}</summary>
                <input aria-label="Bemerkung zum Artikel" value={it.note} onChange={(e) => setItem(i, 'note', e.target.value)} />
              </details>
              {f.items.length > 1 && <button type="button" className="danger sm del" onClick={() => setF((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }))}>Artikel entfernen</button>}
            </div>
          ))}
          <button type="button" className="ghost sm" onClick={() => setF((x) => ({ ...x, items: [...x.items, { ...EMPTY_ITEM }] }))}>Artikel hinzufügen</button>
          <div className="sum">
            <div><span>Warenwert</span><b>CHF {chf(c.goods)}</b></div>
            <div><span>Transportkosten</span><b>{isT ? (c.noPrice ? 'für diese PLZ nicht hinterlegt' : 'CHF ' + chf(c.transport)) : 'CHF 0.00 (Abholung)'}</b></div>
            <div className="tot"><span>Gesamttotal</span><b>CHF {chf(c.total)}</b></div>
          </div>
        </div>
      )}

      <div className="row">
        <button type="submit" disabled={saving}>{saving ? 'Wird gespeichert …' : 'Speichern'}</button>
        {!isC && <button type="button" className="ghost" onClick={() => onPrint({ ...payload(), goods_total: c.goods, transport_cost: c.transport, total: c.total })}>Auftrag drucken</button>}
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Abbrechen</button>}
      </div>
    </form>
  );
}

function Details({ o, ops }) {
  const items = o.items || [];
  return (
    <>
      <div>{addr(o)}</div>
      {(o.phone || o.email) && <div>{o.phone && <a href={'tel:' + o.phone}>{o.phone}</a>}{o.phone && o.email && ' · '}{o.email && <a href={'mailto:' + o.email}>{o.email}</a>}</div>}
      <div className="sub">{LIEFER[o.delivery_type] || 'Transport'}{o.phone_avis ? ' · Telefon-Avis' : ''}{wishText(o) ? ' · Wunsch: ' + wishText(o) : ''}{o.time_from ? ` · ${o.time_from}${o.time_to ? '–' + o.time_to : ''} Uhr` : ''}{o.plan_date ? ' · Geplant: ' + fmtDate(o.plan_date) : ''}</div>
      {ops && <div className="sub">Abteilung: {o.department || DEF_DEPT} · Fahrzeug: {o.vehicle || DEF_VEH}</div>}
      {o.subject && <div><b>Betreff:</b> {o.subject}</div>}
      {items.length > 0 && (
        <ul className="items">
          {items.map((i, k) => <li key={k}>{i.qty} × {i.name} · CHF {chf(i.unit_price)}{i.note && <em> – {i.note}</em>}{ops && i.zukauf && <em> – Zukauf ({ZK_LABEL[i.zk_status || 'zu_bestellen']})</em>}</li>)}
        </ul>
      )}
      {o.goods_total != null && items.length > 0 && (
        <div className="sub">Ware CHF {chf(o.goods_total)} · Transport {o.transport_cost == null ? 'offen' : 'CHF ' + chf(o.transport_cost)} · <b>Total CHF {chf(Number(o.goods_total) + Number(o.transport_cost || 0))}</b></div>
      )}
      {o.load_info && <div>{o.load_info}</div>}
      {o.return_goods && <div className="leergut">Leergut mitnehmen: {o.return_goods}</div>}
    </>
  );
}

const printable = (o) => ({ ...o, total: Number(o.goods_total || 0) + Number(o.transport_cost || 0) });

function PrintSheet({ d }) {
  if (!d) return null;
  if (d.kind === 'fahrten') return <FahrtenSheet d={d} />;
  const items = (d.items || []).filter((i) => i.name);
  const noPrice = d.delivery_type !== 'abholung' && d.transport_cost == null;
  return (
    <div className="sheet">
      <h1>{FIRMA} – Auftrag</h1>
      <p className="sub">Gedruckt am {new Date().toLocaleDateString('de-CH')}</p>
      <table className="pt"><tbody>
        <tr><th>Kunde</th><td>{d.customer_name}</td></tr>
        <tr><th>Adresse</th><td>{d.street}, {d.zip} {d.city}</td></tr>
        {d.phone && <tr><th>Telefon</th><td>{d.phone}</td></tr>}
        {d.email && <tr><th>E-Mail</th><td>{d.email}</td></tr>}
        <tr><th>Lieferart</th><td>{LIEFER[d.delivery_type] || 'Transport'}</td></tr>
        {wishText(d, true) && <tr><th>Wunschdatum</th><td>{wishText(d, true)}</td></tr>}
        {d.time_from && <tr><th>Zeit</th><td>{d.time_from}{d.time_to ? ' – ' + d.time_to : ''} Uhr</td></tr>}
        {d.subject && <tr><th>Transportbetreff</th><td>{d.subject}</td></tr>}
        <tr><th>Telefon-Avis</th><td>{d.phone_avis ? 'Ja' : 'Nein'}</td></tr>
        {d.load_info && <tr><th>Besonderheiten</th><td>{d.load_info}</td></tr>}
        {d.return_goods && <tr><th>Leergut / Retouren</th><td>{d.return_goods}</td></tr>}
      </tbody></table>
      <table className="pt items-t">
        <thead><tr><th>Menge</th><th>Artikel</th><th className="r">Einzelpreis</th><th className="r">Total</th></tr></thead>
        <tbody>
          {items.map((i, k) => (
            <tr key={k}>
              <td>{i.qty}</td>
              <td>{i.name}{i.note && <div className="sub">Bemerkung: {i.note}</div>}</td>
              <td className="r">{chf(i.unit_price)}</td>
              <td className="r">{chf(num(i.qty) * num(i.unit_price))}</td>
            </tr>
          ))}
          <tr><td colSpan={3} className="r">Warenwert CHF</td><td className="r">{chf(d.goods_total)}</td></tr>
          <tr><td colSpan={3} className="r">Transportkosten CHF</td><td className="r">{noPrice ? 'offen' : chf(d.transport_cost)}</td></tr>
          <tr className="tot"><td colSpan={3} className="r">Gesamttotal CHF</td><td className="r">{chf(d.total)}</td></tr>
        </tbody>
      </table>
      <div className="sign"><div>Datum, Unterschrift Kunde</div></div>
    </div>
  );
}

function Prices({ pin, prices, reload }) {
  const [p, setP] = useState({ plz: '', ort: '', preis: '' });
  const [err, setErr] = useState('');
  const run = async (fn) => { setErr(''); try { await fn(); await reload(); } catch (e) { setErr(e.message); } };
  return (
    <details className="card">
      <summary><b>Transportpreise pro PLZ</b> ({prices.length} hinterlegt)</summary>
      <form className="row" style={{ marginTop: 10, alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); run(async () => { await api(pin, '/api/prices', { method: 'POST', body: JSON.stringify(p) }); setP({ plz: '', ort: '', preis: '' }); }); }}>
        <div style={{ width: 90 }}><label>PLZ</label><input required inputMode="numeric" value={p.plz} onChange={(e) => setP({ ...p, plz: e.target.value })} /></div>
        <div style={{ flex: 1, minWidth: 110 }}><label>Ort (optional)</label><input value={p.ort} onChange={(e) => setP({ ...p, ort: e.target.value })} /></div>
        <div style={{ width: 110 }}><label>Preis CHF</label><input required inputMode="decimal" value={p.preis} onChange={(e) => setP({ ...p, preis: e.target.value })} /></div>
        <button type="submit">Speichern</button>
      </form>
      <p className="sub">Eine bestehende PLZ wird mit dem neuen Preis überschrieben.</p>
      {err && <p className="err">{err}</p>}
      {prices.map((x) => (
        <div className="row" key={x.plz} style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', padding: '6px 0' }}>
          <span>{x.plz} {x.ort}</span>
          <span>CHF {chf(x.preis)} <button type="button" className="danger sm" onClick={() => run(() => api(pin, '/api/prices?plz=' + encodeURIComponent(x.plz), { method: 'DELETE' }))}>Löschen</button></span>
        </div>
      ))}
    </details>
  );
}

/* ---------------- Kalender (nur Ansicht, für alle Rollen) ---------------- */

const calDay = (o) => o.plan_date || o.wish_day || (o.completed_at ? new Date(o.completed_at).toLocaleDateString('sv-SE') : null);

function MiniOrder({ o }) {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{o.customer_name}</h3>
        <span>
          <span className={'tag ' + o.status}>{STATUS[o.status]}</span>
          {o.urgency === 'eilig' && <span className="tag abgelehnt" style={{ marginLeft: 6 }}>Eilig</span>}
        </span>
      </div>
      <div>{addr(o)}</div>
      {(o.items || []).length > 0 && <ul className="items">{o.items.map((i, k) => <li key={k}>{i.qty} × {i.name}{i.note && <em> – {i.note}</em>}</li>)}</ul>}
      {o.load_info && <div className="sub">{o.load_info}</div>}
    </div>
  );
}

function CalendarView({ orders }) {
  const n = new Date();
  const [ym, setYm] = useState({ y: n.getFullYear(), m: n.getMonth() });
  const [sel, setSel] = useState(today());
  const pad = (v) => String(v).padStart(2, '0');
  const by = {};
  orders.forEach((o) => { const d = calDay(o); if (d) (by[d] = by[d] || []).push(o); });
  const undated = orders.filter((o) => !calDay(o) && o.status !== 'erledigt');
  const lead = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7;
  const dim = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  const shift = (d) => { const t = new Date(ym.y, ym.m + d, 1); setYm({ y: t.getFullYear(), m: t.getMonth() }); };
  const t0 = today();
  const selList = by[sel] || [];

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="ghost sm" onClick={() => shift(-1)} aria-label="Vorheriger Monat">◀</button>
          <h3 style={{ margin: 0 }}>{MONATE[ym.m]} {ym.y}</h3>
          <button className="ghost sm" onClick={() => shift(1)} aria-label="Nächster Monat">▶</button>
        </div>
        <div className="cal" style={{ marginTop: 10 }}>
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => <div className="dow" key={w}>{w}</div>)}
          {cells.map((d, i) => {
            if (d === null) return <div key={'e' + i} />;
            const k = `${ym.y}-${pad(ym.m + 1)}-${pad(d)}`;
            const list = by[k] || [];
            return (
              <button type="button" key={k} className={'day' + (k === t0 ? ' today' : '') + (k === sel ? ' sel' : '')} onClick={() => setSel(k)} aria-label={`${fmtDate(k)}, ${list.length} Aufträge`}>
                <span className="n">{d}</span>
                {list.length > 0 && <span className="cnt">{list.length}</span>}
                {list.slice(0, 2).map((o) => <span key={o.id} className={'chip2 c-' + o.status}>{o.customer_name}</span>)}
                {list.length > 2 && <span className="chip2 more">+{list.length - 2}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <h2>{fmtDate(sel)}</h2>
      {selList.length === 0 && <p className="sub">An diesem Tag sind keine Aufträge eingetragen.</p>}
      {selList.map((o) => <MiniOrder key={o.id} o={o} />)}

      {undated.length > 0 && (
        <>
          <h2>Ohne Datum</h2>
          {undated.map((o) => <MiniOrder key={o.id} o={o} />)}
        </>
      )}
    </>
  );
}

/* ---------------- Büro: Einstellungen und Zukauf ---------------- */

function ListEditor({ title, hint, kind, list, pin, reload }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const run = async (fn) => { setErr(''); try { await fn(); await reload(); } catch (e) { setErr(e.message); } };
  return (
    <details className="card">
      <summary><b>{title}</b> ({list.length})</summary>
      {hint && <p className="sub">{hint}</p>}
      <form className="row" style={{ alignItems: 'flex-end', marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); run(async () => { await api(pin, '/api/listen', { method: 'POST', body: JSON.stringify({ kind, name }) }); setName(''); }); }}>
        <div style={{ flex: 1, minWidth: 150 }}><label>Neuer Eintrag</label><input required value={name} onChange={(e) => setName(e.target.value)} /></div>
        <button type="submit">Hinzufügen</button>
      </form>
      {err && <p className="err">{err}</p>}
      {list.map((x) => (
        <div className="row" key={x.id} style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', padding: '6px 0', marginTop: 6 }}>
          <span>{x.name}</span>
          <button type="button" className="danger sm" onClick={() => confirm(`«${x.name}» löschen?`) && run(() => api(pin, '/api/listen?id=' + x.id, { method: 'DELETE' }))}>Löschen</button>
        </div>
      ))}
    </details>
  );
}

function Einstellungen({ pin, prices, lists, reload }) {
  return (
    <>
      <Prices pin={pin} prices={prices} reload={reload} />
      <ListEditor title="Lieferanten" hint="Erscheinen im Register Zukauf zur Auswahl." kind="lieferant" list={lists.lieferant} pin={pin} reload={reload} />
      <ListEditor title="Leergut Gebinde" hint="Erscheinen beim Leergut / Retouren zur Auswahl (z. B. Europalette, Mehrwegkiste)." kind="gebinde" list={lists.gebinde} pin={pin} reload={reload} />
      <ListEditor title="Abteilungen" hint="Standard bei neuen Aufträgen: Gärtnerei." kind="abteilung" list={lists.abteilung} pin={pin} reload={reload} />
      <ListEditor title="Fahrzeuge" hint="Standard bei neuen Aufträgen: Gärtnereibus." kind="fahrzeug" list={lists.fahrzeug} pin={pin} reload={reload} />
    </>
  );
}

const ZK_ORDER = ['zu_bestellen', 'bestellt', 'im_betrieb', 'abgeschlossen'];
const ZK_BUTTONS = [['bestellt', 'bestellt'], ['im_betrieb', 'im Betrieb'], ['abgeschlossen', 'abgeschlossen']];

function Zukauf({ orders, pin, reload, lists }) {
  const [filter, setFilter] = useState('offen');
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState('');
  const st = (i) => i.zk_status || 'zu_bestellen';
  const all = orders.flatMap((o) => (o.items || []).filter((i) => i.zukauf && i.id).map((i) => ({ ...i, order: o })));
  const shown = all
    .filter((i) => (filter === 'offen' ? st(i) !== 'abgeschlossen' : st(i) === filter))
    .sort((a, b) => ZK_ORDER.indexOf(st(a)) - ZK_ORDER.indexOf(st(b)) || a.order.customer_name.localeCompare(b.order.customer_name));
  const upd = async (i, p) => {
    setErr('');
    try { await send(pin, 'PATCH', { action: 'zukauf', id: i.order.id, item_id: i.id, ...p }); await reload(); } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="chips">
        {[['offen', 'Offene'], ['zu_bestellen', 'Zu bestellen'], ['bestellt', 'Bestellt'], ['im_betrieb', 'Im Betrieb'], ['abgeschlossen', 'Abgeschlossen']].map(([k, label]) => (
          <button key={k} className={'chip' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      {err && <p className="err">{err}</p>}
      {shown.length === 0 && <p className="sub">Keine Artikel in dieser Ansicht. Artikel markieren Sie im Auftrag mit «Zukauf, nicht lagernd».</p>}
      {shown.map((i) => {
        const o = i.order;
        const isOpen = openId === i.id;
        return (
          <div className="card" key={i.id}>
            <button type="button" className="linkrow" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : i.id)}>
              <b>{i.qty} × {i.name}</b>
              <span className={'tag' + (st(i) === 'zu_bestellen' ? ' offen' : '')}>{ZK_LABEL[st(i)]}</span>
            </button>
            <div className="row" style={{ marginTop: 8 }}>
              <select aria-label="Lieferant" style={{ flex: 1, minWidth: 160 }} value={i.supplier || ''} onChange={(e) => upd(i, { supplier: e.target.value })}>
                <option value="">Lieferant wählen</option>
                {opts(lists.lieferant, i.supplier).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {ZK_BUTTONS.map(([k, label]) => (
                <button key={k} type="button" className={'sm' + (st(i) === k ? '' : ' ghost')} aria-pressed={st(i) === k} onClick={() => upd(i, { zk_status: st(i) === k ? 'zu_bestellen' : k })}>{label}</button>
              ))}
            </div>
            {isOpen && (
              <div className="panel">
                <b>Auftrag</b>
                <div>{o.customer_name} · <span className={'tag ' + o.status}>{STATUS[o.status]}</span></div>
                <div>{addr(o)}</div>
                {(o.phone || o.email) && <div className="sub">{o.phone}{o.phone && o.email ? ' · ' : ''}{o.email}</div>}
                <div className="sub">Termin: {o.plan_date ? fmtDate(o.plan_date) : wishText(o) || 'kein Datum'}</div>
                <b style={{ display: 'block', marginTop: 8 }}>Artikel</b>
                <div>Menge: {i.qty} · Artikel: {i.name}</div>
                <div>Einzelpreis: CHF {chf(i.unit_price)} · Total: CHF {chf(num(i.qty) * num(i.unit_price))}</div>
                {i.note && <div>Bemerkung: {i.note}</div>}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ---------------- Büro ---------------- */

function Buero({ orders, pin, reload, prices, lists, onPrint }) {
  const [tab, setTab] = useState('kalender');
  const [editing, setEditing] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('pendent');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const declined = orders.filter((o) => o.status === 'abgelehnt' && !o.decline_ack);
  const pending = orders.filter((o) => o.status === 'pendent');
  const zkNew = orders.flatMap((o) => (o.items || []).filter((i) => i.zukauf && (i.zk_status || 'zu_bestellen') === 'zu_bestellen')).length;
  const rank = (o) => (o.status === 'pendent' ? 0 : o.status === 'erledigt' ? 2 : 1);
  const shown = orders
    .filter((o) => filter === 'alle' || o.status === filter)
    .filter((o) => !q || JSON.stringify([o.customer_name, o.street, o.city, o.zip, o.load_info, o.subject, o.phone, o.email, o.items]).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => rank(a) - rank(b) || (b.created_at > a.created_at ? 1 : -1));

  const act = async (fn) => { setErr(''); try { await fn(); await reload(); } catch (e) { setErr(e.message); } };
  const patch = (body) => act(() => send(pin, 'PATCH', body));
  const go = (t) => { setTab(t); setMsg(''); };

  async function save(payload) {
    setSaving(true);
    setMsg('');
    await act(async () => {
      if (payload.id) {
        const { id, ...fields } = payload;
        await send(pin, 'PATCH', { action: 'edit', id, fields });
        setEditing(null);
        setMsg('Änderungen gespeichert.');
      } else {
        await send(pin, 'POST', payload);
        setNonce((x) => x + 1);
        setMsg('Auftrag gespeichert.');
      }
    });
    setSaving(false);
  }

  const tabBtn = (k, label) => <button className={'chip' + (tab === k ? ' on' : '')} onClick={() => go(k)}>{label}</button>;

  return (
    <>
      {declined.map((o) => (
        <div className="banner" role="alert" key={o.id}>
          <b>Auftrag abgelehnt: {o.customer_name}</b>
          <div>{addr(o)}</div>
          <div><b>Grund:</b> {o.decline_reason}</div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="sm" onClick={() => patch({ action: 'ack', id: o.id })}>Zur Kenntnis genommen</button>
            <button className="sm ghost" onClick={() => patch({ action: 'reassign', id: o.id })}>Neu zuweisen</button>
          </div>
        </div>
      ))}
      {pending.length > 0 && (
        <div className="banner info" role="status">
          <b>{pending.length} {pending.length === 1 ? 'neuer Auftrag' : 'neue Aufträge'} zu bearbeiten</b>
          <div style={{ marginTop: 8 }}><button className="sm" onClick={() => { setFilter('pendent'); go('liste'); }}>Anzeigen</button></div>
        </div>
      )}
      {err && <p className="err">{err}</p>}

      <div className="chips">
        {tabBtn('kalender', 'Kalender')}
        {tabBtn('neu', 'Neuer Auftrag')}
        {tabBtn('liste', 'Aufträge' + (pending.length ? ` (${pending.length} pendent)` : ''))}
        {tabBtn('zukauf', 'Zukauf' + (zkNew ? ` (${zkNew})` : ''))}
        {tabBtn('einstellungen', 'Einstellungen')}
      </div>
      {msg && <div className="banner info" role="status">{msg}</div>}

      {tab === 'kalender' && <CalendarView orders={orders} />}

      {tab === 'neu' && <OrderForm key={'neu' + nonce} init={{}} role="buero" pin={pin} lists={lists} prices={prices} saving={saving} onSave={save} onPrint={onPrint} />}

      {tab === 'liste' && (
        <>
          {editing && <OrderForm key={editing.id} init={editing} role="buero" pin={pin} lists={lists} prices={prices} saving={saving} onSave={save} onCancel={() => setEditing(null)} onPrint={onPrint} />}
          <input type="search" placeholder="Suchen (Kunde, Ort, Artikel …)" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips">
            {['pendent', 'offen', 'eingeplant', 'abgelehnt', 'erledigt', 'alle'].map((s) => (
              <button key={s} className={'chip' + (filter === s ? ' on' : '')} onClick={() => setFilter(s)}>
                {s === 'alle' ? 'Alle' : STATUS[s]} ({s === 'alle' ? orders.length : orders.filter((o) => o.status === s).length})
              </button>
            ))}
          </div>
          {shown.length === 0 && <p className="sub">Keine Aufträge gefunden.</p>}
          {shown.map((o) => (
            <div className={'card' + (o.urgency === 'eilig' ? ' eilig' : '') + (o.status === 'pendent' ? ' pend' : '')} key={o.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3>{o.customer_name}</h3>
                <span><span className={'tag ' + o.status}>{STATUS[o.status]}</span>{o.urgency === 'eilig' && <span className="tag abgelehnt" style={{ marginLeft: 6 }}>Eilig</span>}</span>
              </div>
              <Details o={o} ops />
              {o.status === 'abgelehnt' && <div className="sub">Abgelehnt: {o.decline_reason}</div>}
              {o.driver_note && <div><b>Chauffeur:</b> {o.driver_note}</div>}
              {o.photo_url && <a href={o.photo_url} target="_blank" rel="noreferrer"><img className="photo" src={o.photo_url} alt={'Ablieferfoto ' + o.customer_name} loading="lazy" /></a>}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="sm ghost" onClick={() => { setEditing(o); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Bearbeiten</button>
                {o.status === 'pendent' && o.delivery_type !== 'abholung' && <button className="sm" onClick={() => patch({ action: 'release', id: o.id })}>Für Chauffeur freigeben</button>}
                {o.delivery_type === 'abholung' && (o.status === 'pendent' || o.status === 'offen') && <button className="sm" onClick={() => patch({ action: 'finish', id: o.id })}>Abgeholt / erledigt</button>}
                {o.status === 'abgelehnt' && <button className="sm ghost" onClick={() => patch({ action: 'reassign', id: o.id })}>Neu zuweisen</button>}
                <button className="sm ghost" onClick={() => onPrint(printable(o))}>Drucken</button>
                <button className="sm danger" onClick={() => confirm(`Auftrag «${o.customer_name}» löschen?`) && act(() => api(pin, '/api/orders?id=' + o.id, { method: 'DELETE' }))}>Löschen</button>
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'zukauf' && <Zukauf orders={orders} pin={pin} reload={reload} lists={lists} />}

      {tab === 'einstellungen' && <Einstellungen pin={pin} prices={prices} lists={lists} reload={reload} />}
    </>
  );
}

/* ---------------- Kasse ---------------- */

function Kasse({ orders, pin, reload, prices, onPrint }) {
  const [tab, setTab] = useState('kalender');
  const [nonce, setNonce] = useState(0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const go = (t) => { setTab(t); setMsg(''); setErr(''); };

  async function save(payload) {
    setSaving(true);
    setErr('');
    try {
      await send(pin, 'POST', payload);
      setNonce((x) => x + 1);
      await reload();
      setTab('pendent');
      setMsg('Auftrag gespeichert. Das Büro bearbeitet ihn jetzt.');
    } catch (e) { setErr(e.message); }
    setSaving(false);
  }

  const match = (o) => !q || JSON.stringify([o.customer_name, o.street, o.city, o.zip, o.phone, o.items]).toLowerCase().includes(q.toLowerCase());
  const pending = orders.filter((o) => o.status === 'pendent' || o.status === 'abgelehnt');
  const shown = pending.filter(match);

  return (
    <>
      <div className="chips">
        <button className={'chip' + (tab === 'kalender' ? ' on' : '')} onClick={() => go('kalender')}>Kalender</button>
        <button className={'chip' + (tab === 'neu' ? ' on' : '')} onClick={() => go('neu')}>Neuer Auftrag</button>
        <button className={'chip' + (tab === 'pendent' ? ' on' : '')} onClick={() => go('pendent')}>Pendente Aufträge ({pending.length})</button>
      </div>
      {msg && <div className="banner info" role="status">{msg}</div>}
      {err && <p className="err">{err}</p>}

      {tab === 'kalender' && <CalendarView orders={orders} />}

      {tab === 'neu' && <OrderForm key={'neu' + nonce} init={{}} role="kasse" pin={pin} prices={prices} saving={saving} onSave={save} onPrint={onPrint} />}

      {tab === 'pendent' && (
        <>
          <input type="search" placeholder="Pendente Aufträge suchen" value={q} onChange={(e) => setQ(e.target.value)} />
          {shown.length === 0 && <p className="sub">Keine pendenten Aufträge.</p>}
          {shown.map((o) => (
            <div className={'card' + (o.status === 'abgelehnt' ? ' eilig' : ' pend')} key={o.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3>{o.customer_name}</h3>
                <span className={'tag ' + o.status}>{STATUS[o.status]}</span>
              </div>
              <Details o={o} />
              {o.status === 'abgelehnt' && <div className="sub"><b>Abgelehnt:</b> {o.decline_reason}</div>}
              <div className="row" style={{ marginTop: 10 }}><button className="sm ghost" onClick={() => onPrint(printable(o))}>Drucken</button></div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* ---------------- Chauffeur ---------------- */

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const parseHM = (s) => {
  const t = String(s).trim();
  const m = t.match(/^(\d{1,2}):([0-5]\d)$/);
  const min = m ? +m[1] * 60 + +m[2] : Math.round(num(t) * 60);
  return min >= 1 && min <= 1440 ? min : null;
};
const dmy = (d) => d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4);
const eff = (o) => o.plan_date || o.wish_day || null;
const clock = (iso) => new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });

function Chauffeur({ orders, pin, reload, ios, onPrint, lists }) {
  const [tab, setTab] = useState('tour');
  const [day, setDay] = useState(today());
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [dragId, setDragId] = useState(null);
  const [trips, setTrips] = useState([]);
  const [nonce, setNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [, setTick] = useState(0);

  const loadTrips = useCallback(async () => { try { setTrips((await api(pin, '/api/fahrten')).trips); } catch {} }, [pin]);
  useEffect(() => { loadTrips(); }, [loadTrips]);
  const active = trips.find((t) => !t.ended_at);
  const activeId = active ? active.id : null;
  useEffect(() => {
    if (!activeId) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [activeId]);
  const secs = active ? Math.max(0, Math.floor((Date.now() - new Date(active.started_at).getTime()) / 1000)) : 0;
  const p2 = (v) => String(v).padStart(2, '0');
  const timer = `${p2(Math.floor(secs / 3600))}:${p2(Math.floor((secs % 3600) / 60))}:${p2(secs % 60)}`;

  const open = orders.filter((o) => o.status === 'offen' || o.status === 'eingeplant').sort((a, b) => a.sort_order - b.sort_order);
  const dayList = open.filter((o) => eff(o) === day);
  const rest = open.filter((o) => eff(o) !== day);

  const act = async (fn) => { setErr(''); try { await fn(); await reload(); } catch (e) { setErr(e.message); throw e; } };
  const tripAct = async (body) => {
    setErr('');
    try { await api(pin, '/api/fahrten', { method: 'POST', body: JSON.stringify(body) }); await loadTrips(); } catch (e) { setErr(e.message); }
  };
  const reorder = (list, from, to) => {
    if (to < 0 || to >= list.length || from === to) return;
    const ids = list.map((o) => o.id);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    act(() => send(pin, 'PATCH', { action: 'reorder', ids })).catch(() => {});
  };
  async function saveNew(payload) {
    setSaving(true); setErr(''); setMsg('');
    try { await send(pin, 'POST', payload); setNonce((x) => x + 1); setMsg('Auftrag gespeichert und ans Büro übermittelt.'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (e) { setErr(e.message); }
    setSaving(false);
  }
  const go = (t) => { setTab(t); setMsg(''); setErr(''); };

  const routeUrl = 'https://www.google.com/maps/dir//' + dayList.map((o) => encodeURIComponent(addr(o))).join('/');

  const renderList = (list) =>
    list.map((o, i) => (
      <Card key={o.id} o={o} i={i} n={list.length} pin={pin} ios={ios} act={act}
        onMove={(d) => reorder(list, i, i + d)}
        drag={{
          draggable: true,
          onDragStart: () => setDragId(o.id),
          onDragOver: (e) => e.preventDefault(),
          onDrop: () => { const from = list.findIndex((x) => x.id === dragId); if (from > -1) reorder(list, from, i); setDragId(null); },
        }} />
    ));

  return (
    <>
      <div className="chips">
        <button className={'chip' + (tab === 'kalender' ? ' on' : '')} onClick={() => go('kalender')}>Kalender</button>
        <button className={'chip' + (tab === 'tour' ? ' on' : '')} onClick={() => go('tour')}>Tour</button>
        <button className={'chip' + (tab === 'neu' ? ' on' : '')} onClick={() => go('neu')}>Neuer Auftrag</button>
        <button className={'chip' + (tab === 'fahrten' ? ' on' : '')} onClick={() => go('fahrten')}>Fahrten</button>
      </div>
      {msg && <div className="banner info" role="status">{msg}</div>}
      {err && <p className="err">{err}</p>}

      {tab === 'kalender' && <CalendarView orders={orders} />}

      {tab === 'neu' && <OrderForm key={'neu' + nonce} init={{}} role="chauffeur" pin={pin} lists={lists} saving={saving} onSave={saveNew} />}

      {tab === 'fahrten' && <Fahrten pin={pin} trips={trips} reloadTrips={loadTrips} onPrint={onPrint} />}

      {tab === 'tour' && (
        <>
          <div className="card">
            <label htmlFor="day">Tag</label>
            <input id="day" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
            {active ? (
              <>
                <div className="banner info" style={{ marginTop: 10 }}>
                  <div>Fahrt läuft seit {clock(active.started_at)} Uhr</div>
                  <div className="timer" aria-live="off">{timer}</div>
                </div>
                <button className="big red" type="button" onClick={() => {
                  const txt = dayList.length ? `Für diesen Tag sind noch ${dayList.length} Aufträge offen. Fahrt trotzdem beenden?` : 'Fahrt beenden? Die Zeit wird gestoppt und im Register Fahrten abgelegt.';
                  if (confirm(txt)) tripAct({ action: 'end' });
                }}>Fahrt beenden</button>
              </>
            ) : (
              <div style={{ marginTop: 10 }}><button className="big" type="button" onClick={() => tripAct({ action: 'start' })}>Fahrt starten</button></div>
            )}
            <div style={{ marginTop: 10 }}>
              {dayList.length ? (
                <a href={routeUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}><button className="big ghost" type="button">Tagesroute in Google Maps öffnen ({dayList.length} Stopps)</button></a>
              ) : (
                <button className="big ghost" disabled>Tagesroute in Google Maps öffnen</button>
              )}
            </div>
          </div>

          <h2>Geplant für {fmtDate(day)}</h2>
          {dayList.length === 0 && <p className="sub">Noch nichts eingeplant für diesen Tag.</p>}
          {renderList(dayList)}

          <h2>Offene Aufträge (anderer Tag oder ohne Datum)</h2>
          {rest.length === 0 && <p className="sub">Keine weiteren offenen Aufträge.</p>}
          {renderList(rest)}
        </>
      )}
    </>
  );
}

function FahrtenSheet({ d }) {
  return (
    <div className="sheet">
      <h1>{FIRMA} – Fahrtenübersicht</h1>
      <p className="sub">Monat {d.label} · gedruckt am {new Date().toLocaleDateString('de-CH')}</p>
      <table className="pt items-t">
        <thead><tr><th>Datum</th><th>Beginn</th><th>Ende</th><th className="r">Zeit (Std:Min)</th></tr></thead>
        <tbody>
          {d.trips.map((t) => <tr key={t.id}><td>{dmy(t.day)}</td><td>{clock(t.started_at)}</td><td>{clock(t.ended_at)}</td><td className="r">{hhmm(t.minutes)}</td></tr>)}
          <tr className="tot"><td colSpan={3} className="r">Total Stunden</td><td className="r">{hhmm(d.totMin)}</td></tr>
        </tbody>
      </table>
      <div className="sign"><div>Name, Unterschrift Chauffeur</div></div>
    </div>
  );
}

function Fahrten({ pin, trips, reloadTrips, onPrint }) {
  const n = new Date();
  const [ym, setYm] = useState(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`);
  const [err, setErr] = useState('');
  const [y, m] = ym.split('-').map(Number);
  const shift = (d) => { const t = new Date(y, m - 1 + d, 1); setYm(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`); setErr(''); };
  const list = trips.filter((t) => t.ended_at && t.day.startsWith(ym)).sort((a, b) => (a.day + a.started_at > b.day + b.started_at ? 1 : -1));
  const totMin = list.reduce((s, t) => s + t.minutes, 0);

  const run = async (fn) => { setErr(''); try { await fn(); await reloadTrips(); } catch (e) { setErr(e.message); } };
  const save = (t, patch) => run(() => api(pin, '/api/fahrten', { method: 'PATCH', body: JSON.stringify({ id: t.id, ...patch }) }));

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="ghost sm" onClick={() => shift(-1)} aria-label="Vorheriger Monat">◀</button>
          <h3 style={{ margin: 0 }}>{MONATE[m - 1]} {y}</h3>
          <button className="ghost sm" onClick={() => shift(1)} aria-label="Nächster Monat">▶</button>
        </div>
        <div className="sum">
          <div className="tot"><span>Total Stunden</span><b>{hhmm(totMin)}</b></div>
        </div>
      </div>
      {err && <p className="err">{err}</p>}

      {list.length === 0 && <p className="sub">Für diesen Monat gibt es noch keine abgeschlossenen Fahrten.</p>}
      {list.map((t) => (
        <div className="card" key={t.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>{dmy(t.day)}</h3>
            <span className="sub">{clock(t.started_at)} – {clock(t.ended_at)} Uhr</span>
          </div>
          <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
            <div style={{ width: 130 }}>
              <label>Zeit (Std:Min)</label>
              <input defaultValue={hhmm(t.minutes)} key={'m' + t.id + t.minutes} inputMode="numeric" placeholder="02:30"
                onBlur={(e) => {
                  const v = parseHM(e.target.value);
                  if (v == null) { setErr('Bitte die Zeit als Std:Min eingeben, z. B. 02:30'); e.target.value = hhmm(t.minutes); }
                  else if (v !== t.minutes) save(t, { minutes: v });
                }} />
            </div>
            <button className="danger sm" onClick={() => confirm('Diese Fahrt löschen?') && run(() => api(pin, '/api/fahrten?id=' + t.id, { method: 'DELETE' }))}>Löschen</button>
          </div>
        </div>
      ))}

      <button className="big" disabled={!list.length} onClick={() => onPrint({ kind: 'fahrten', label: `${MONATE[m - 1]} ${y}`, trips: list, totMin })}>Monatsübersicht drucken / als PDF speichern</button>
      <p className="sub">Im Druckfenster können Sie den Drucker wählen oder «Als PDF speichern».</p>
    </>
  );
}

function DateControl({ o, pin, act }) {
  const plan = (d) => act(() => send(pin, 'PATCH', { action: 'plan', id: o.id, plan_date: d })).catch(() => {});
  if (o.wish_day && o.date_mode !== 'flex')
    return <div style={{ flex: 1, minWidth: 150 }}><label>Termin</label><div className="ro"><b>Fix:</b> {fmtDate(o.wish_day)} (nicht änderbar)</div></div>;
  if (o.wish_day) {
    const base = new Date(o.wish_day + 'T12:00:00');
    const opts = [];
    for (let k = -FLEX_DAYS; k <= FLEX_DAYS; k++) { const d = new Date(base); d.setDate(d.getDate() + k); opts.push(d.toLocaleDateString('sv-SE')); }
    return (
      <div style={{ flex: 1, minWidth: 150 }}>
        <label>Datum (± {FLEX_DAYS} Tage)</label>
        <select value={o.plan_date || o.wish_day} onChange={(e) => plan(e.target.value)}>
          {opts.map((d) => <option key={d} value={d}>{fmtDate(d)}{d === o.wish_day ? ' – Wunschdatum' : ''}</option>)}
        </select>
      </div>
    );
  }
  return <div style={{ flex: 1, minWidth: 150 }}><label>Datum</label><input type="date" value={o.plan_date || ''} onChange={(e) => plan(e.target.value)} /></div>;
}

function Card({ o, i, n, pin, ios, act, onMove, drag }) {
  const [panel, setPanel] = useState(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [blob, setBlob] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const mapUrl = ios
    ? 'https://maps.apple.com/?daddr=' + encodeURIComponent(addr(o))
    : 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr(o));

  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const b = await compress(f);
    setBlob(b);
    setPreview(URL.createObjectURL(b));
  }

  async function complete() {
    setBusy(true);
    try {
      let url = null;
      if (blob) {
        const fd = new FormData();
        fd.append('file', blob, 'foto.jpg');
        url = (await api(pin, '/api/upload', { method: 'POST', body: fd })).url;
      }
      await act(() => send(pin, 'PATCH', { action: 'complete', id: o.id, note, photo_url: url }));
    } catch {} finally { setBusy(false); }
  }

  return (
    <div className={'card drag' + (o.urgency === 'eilig' ? ' eilig' : '')} {...drag}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>{o.customer_name}</h3>
        {o.urgency === 'eilig' && <span className="tag abgelehnt">Eilig</span>}
      </div>
      <a className="addr" href={mapUrl} target="_blank" rel="noreferrer">{addr(o)}</a>
      {o.phone && <a href={'tel:' + o.phone}>Anrufen: {o.phone}</a>}
      {o.time_from && <div className="sub">Zeit: {o.time_from}{o.time_to ? ' – ' + o.time_to : ''} Uhr</div>}
      <div className="sub">{o.department || DEF_DEPT} · {o.vehicle || DEF_VEH}</div>
      {o.subject && <div style={{ marginTop: 6 }}><b>{o.subject}</b></div>}
      {o.load_info && <div style={{ marginTop: 6 }}>{o.load_info}</div>}
      {(o.items || []).length > 0 && <ul className="items">{o.items.map((it, k) => <li key={k}>{it.qty} × {it.name}{it.note && <em> – {it.note}</em>}</li>)}</ul>}
      {o.return_goods && <div className="leergut">Leergut mitnehmen: {o.return_goods}</div>}
      {!o.wish_day && o.wish_date && <div className="sub">Kundenwunsch: {o.wish_date}</div>}

      <div className="row" style={{ marginTop: 10 }}>
        <DateControl o={o} pin={pin} act={act} />
        <button className="ghost sm" aria-label="Nach oben" disabled={i === 0} onClick={() => onMove(-1)}>▲</button>
        <button className="ghost sm" aria-label="Nach unten" disabled={i === n - 1} onClick={() => onMove(1)}>▼</button>
      </div>

      {!panel && (
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={() => setPanel('done')}>Erledigt</button>
          <button className="danger" onClick={() => setPanel('decline')}>Auftrag ablehnen</button>
        </div>
      )}

      {panel === 'done' && (
        <div className="panel">
          <label>Foto der abgeladenen Ware</label>
          <input type="file" accept="image/*" capture="environment" onChange={pick} />
          {preview && <img className="photo" src={preview} alt="Vorschau" />}
          <label style={{ marginTop: 8 }}>Notiz (optional)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button disabled={busy} onClick={complete}>{busy ? 'Wird gesendet …' : 'Als erledigt abschliessen'}</button>
            <button className="ghost" disabled={busy} onClick={() => setPanel(null)}>Zurück</button>
          </div>
        </div>
      )}

      {panel === 'decline' && (
        <div className="panel">
          <label>Grund der Ablehnung</label>
          <textarea autoFocus placeholder="z. B. Zufahrt zu eng für LKW, Fahrzeug voll, Kunde nicht erreichbar" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="red" disabled={!reason.trim() || busy} onClick={async () => { setBusy(true); try { await act(() => send(pin, 'PATCH', { action: 'decline', id: o.id, reason })); } catch {} finally { setBusy(false); } }}>Ablehnung senden</button>
            <button className="ghost" onClick={() => setPanel(null)}>Zurück</button>
          </div>
        </div>
      )}
    </div>
  );
}

function App(props) {
  const [pd, setPd] = useState(null);
  useEffect(() => {
    if (!pd) return;
    const t = setTimeout(() => window.print(), 100);
    return () => clearTimeout(t);
  }, [pd]);
  return (
    <>
      <div className="noprint"><AppInner {...props} onPrint={(d) => setPd({ ...d })} /></div>
      <PrintSheet d={pd} />
    </>
  );
}
