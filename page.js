'use client';
import { useEffect, useState, useCallback } from 'react';

const addr = (o) => `${o.street}, ${o.zip} ${o.city}`;
const today = () => new Date().toLocaleDateString('sv-SE');
const STATUS = { offen: 'Offen', eingeplant: 'Eingeplant', abgelehnt: 'Abgelehnt', erledigt: 'Erledigt' };
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
    const ok = r === 'buero' || r === 'chauffeur';
    setRole(ok ? r : 'none');
    setPin(ok ? localStorage.getItem('pin-' + r) : null);
  }, []);

  if (!role) return null;
  if (role === 'none')
    return (
      <main>
        <h1>Transportplanung</h1>
        <p>Bitte den Link mit Rolle öffnen:</p>
        <p><a href="/?role=buero">Büro</a> · <a href="/?role=chauffeur">Chauffeur</a></p>
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
      <h1>{role === 'buero' ? 'Büro' : 'Chauffeur'}</h1>
      <label htmlFor="pin">PIN eingeben</label>
      <input id="pin" type="password" inputMode="numeric" autoComplete="off" autoFocus value={v} onChange={change} />
      {err && <p className="err">{err}</p>}
    </main>
  );
}

function App({ role, pin, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [ios, setIos] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await api(pin, '/api/orders');
      setOrders(r.orders);
      setError('');
    } catch (e) {
      if (e.code === 401) onLogout();
      else setError('Keine Verbindung – es wird weiter versucht.');
    }
  }, [pin, onLogout]);

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
        <h1>{role === 'buero' ? 'Transporte – Büro' : 'Meine Touren'}</h1>
        <button className="ghost sm" onClick={onLogout}>Abmelden</button>
      </div>
      {error && <p className="err">{error}</p>}
      {role === 'buero' ? <Buero orders={orders} pin={pin} reload={reload} /> : <Chauffeur orders={orders} pin={pin} reload={reload} ios={ios} />}
    </main>
  );
}

/* ---------------- Büro ---------------- */

const EMPTY = { customer_name: '', street: '', zip: '', city: '', phone: '', wish_date: '', load_info: '', return_goods: '', urgency: 'normal' };

function Buero({ orders, pin, reload }) {
  const [form, setForm] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('alle');
  const [err, setErr] = useState('');

  const declined = orders.filter((o) => o.status === 'abgelehnt' && !o.decline_ack);
  const shown = orders
    .filter((o) => filter === 'alle' || o.status === filter)
    .filter((o) => !q || JSON.stringify([o.customer_name, o.street, o.city, o.zip, o.load_info, o.phone]).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.status === 'erledigt') - (b.status === 'erledigt') || (b.created_at > a.created_at ? 1 : -1));

  const act = async (fn) => { setErr(''); try { await fn(); await reload(); } catch (e) { setErr(e.message); } };

  async function save(e) {
    e.preventDefault();
    await act(async () => {
      if (form.id) {
        const { id, ...fields } = form;
        await send(pin, 'PATCH', { action: 'edit', id, fields: Object.fromEntries(Object.keys(EMPTY).map((k) => [k, fields[k]])) });
      } else await send(pin, 'POST', form);
      setForm(null);
    });
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      {declined.map((o) => (
        <div className="banner" role="alert" key={o.id}>
          <b>Auftrag abgelehnt: {o.customer_name}</b>
          <div>{addr(o)}</div>
          <div><b>Grund:</b> {o.decline_reason}</div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="sm" onClick={() => act(() => send(pin, 'PATCH', { action: 'ack', id: o.id }))}>Zur Kenntnis genommen</button>
            <button className="sm ghost" onClick={() => act(() => send(pin, 'PATCH', { action: 'reassign', id: o.id }))}>Neu zuweisen</button>
          </div>
        </div>
      ))}
      {err && <p className="err">{err}</p>}

      {!form ? (
        <button className="big" onClick={() => setForm({ ...EMPTY })}>Neuer Transportauftrag</button>
      ) : (
        <form className="card" onSubmit={save}>
          <h2 style={{ marginTop: 0 }}>{form.id ? 'Auftrag bearbeiten' : 'Neuer Transportauftrag'}</h2>
          <div className="grid">
            <div className="full"><label>Kundenname *</label><input required value={form.customer_name} onChange={set('customer_name')} /></div>
            <div className="full"><label>Strasse und Nr. *</label><input required value={form.street} onChange={set('street')} /></div>
            <div><label>PLZ *</label><input required inputMode="numeric" value={form.zip} onChange={set('zip')} /></div>
            <div><label>Ort *</label><input required value={form.city} onChange={set('city')} /></div>
            <div><label>Telefon Kunde</label><input type="tel" value={form.phone || ''} onChange={set('phone')} /></div>
            <div><label>Wunschdatum / Zeitraum</label><input placeholder="z. B. 12.12. oder KW 50" value={form.wish_date || ''} onChange={set('wish_date')} /></div>
            <div className="full"><label>Ladung und Besonderheiten</label><textarea placeholder="Pflanzenart, Anzahl Paletten, Kran/Hebebühne, Ablageort …" value={form.load_info || ''} onChange={set('load_info')} /></div>
            <div className="full"><label>Leergut / Retouren mitnehmen</label><input placeholder="z. B. 3 Europaletten" value={form.return_goods || ''} onChange={set('return_goods')} /></div>
            <div className="full"><label>Dringlichkeit</label>
              <select value={form.urgency} onChange={set('urgency')}><option value="normal">Normal</option><option value="eilig">Eilig</option></select></div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="submit">Speichern</button>
            <button type="button" className="ghost" onClick={() => setForm(null)}>Abbrechen</button>
          </div>
        </form>
      )}

      <h2>Alle Aufträge</h2>
      <input type="search" placeholder="Suchen (Kunde, Ort, Ladung …)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        {['alle', 'offen', 'eingeplant', 'abgelehnt', 'erledigt'].map((s) => (
          <button key={s} className={'chip' + (filter === s ? ' on' : '')} onClick={() => setFilter(s)}>
            {s === 'alle' ? 'Alle' : STATUS[s]} ({s === 'alle' ? orders.length : orders.filter((o) => o.status === s).length})
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="sub">Keine Aufträge gefunden.</p>}
      {shown.map((o) => (
        <div className={'card' + (o.urgency === 'eilig' ? ' eilig' : '')} key={o.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>{o.customer_name}</h3>
            <span><span className={'tag ' + o.status}>{STATUS[o.status]}</span>{o.urgency === 'eilig' && <span className="tag abgelehnt" style={{ marginLeft: 6 }}>Eilig</span>}</span>
          </div>
          <div>{addr(o)}{o.phone && <> · <a href={'tel:' + o.phone}>{o.phone}</a></>}</div>
          {o.load_info && <div>{o.load_info}</div>}
          {o.return_goods && <div className="leergut">Leergut mitnehmen: {o.return_goods}</div>}
          <div className="sub">
            {o.wish_date && <>Wunsch: {o.wish_date}. </>}
            {o.plan_date && <>Geplant: {fmtDate(o.plan_date)}. </>}
            {o.status === 'abgelehnt' && <>Abgelehnt: {o.decline_reason}</>}
          </div>
          {o.driver_note && <div><b>Chauffeur:</b> {o.driver_note}</div>}
          {o.photo_url && <a href={o.photo_url} target="_blank" rel="noreferrer"><img className="photo" src={o.photo_url} alt={'Ablieferfoto ' + o.customer_name} loading="lazy" /></a>}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="sm ghost" onClick={() => { setForm({ ...EMPTY, ...o }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Bearbeiten</button>
            {o.status === 'abgelehnt' && <button className="sm ghost" onClick={() => act(() => send(pin, 'PATCH', { action: 'reassign', id: o.id }))}>Neu zuweisen</button>}
            <button className="sm danger" onClick={() => confirm(`Auftrag «${o.customer_name}» löschen?`) && act(() => api(pin, '/api/orders?id=' + o.id, { method: 'DELETE' }))}>Löschen</button>
          </div>
        </div>
      ))}
    </>
  );
}

/* ---------------- Chauffeur ---------------- */

function Chauffeur({ orders, pin, reload, ios }) {
  const [day, setDay] = useState(today());
  const [err, setErr] = useState('');
  const [dragId, setDragId] = useState(null);

  const open = orders.filter((o) => o.status === 'offen' || o.status === 'eingeplant').sort((a, b) => a.sort_order - b.sort_order);
  const dayList = open.filter((o) => o.plan_date === day);
  const rest = open.filter((o) => o.plan_date !== day);

  const act = async (fn) => { setErr(''); try { await fn(); await reload(); } catch (e) { setErr(e.message); throw e; } };
  const reorder = (list, from, to) => {
    if (to < 0 || to >= list.length || from === to) return;
    const ids = list.map((o) => o.id);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    act(() => send(pin, 'PATCH', { action: 'reorder', ids })).catch(() => {});
  };

  const routeUrl = 'https://www.google.com/maps/dir//' + dayList.map((o) => encodeURIComponent(addr(o))).join('/');

  const renderList = (list) =>
    list.map((o, i) => (
      <Card key={o.id} o={o} i={i} n={list.length} pin={pin} ios={ios} act={act} day={day}
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
      <div className="card">
        <label htmlFor="day">Tag</label>
        <input id="day" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <div style={{ marginTop: 10 }}>
          {dayList.length ? (
            <a href={routeUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              <button className="big" type="button">Tagesroute in Google Maps öffnen ({dayList.length} Stopps)</button>
            </a>
          ) : (
            <button className="big" disabled>Tagesroute in Google Maps öffnen</button>
          )}
        </div>
      </div>
      {err && <p className="err">{err}</p>}

      <h2>Geplant für {fmtDate(day)}</h2>
      {dayList.length === 0 && <p className="sub">Noch nichts eingeplant. Wähle unten bei einem Auftrag dieses Datum.</p>}
      {renderList(dayList)}

      <h2>Offene Aufträge (anderer Tag oder nicht eingeplant)</h2>
      {rest.length === 0 && <p className="sub">Keine weiteren offenen Aufträge.</p>}
      {renderList(rest)}
    </>
  );
}

function Card({ o, i, n, pin, ios, act, day, onMove, drag }) {
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
      {o.load_info && <div style={{ marginTop: 6 }}>{o.load_info}</div>}
      {o.return_goods && <div className="leergut">Leergut mitnehmen: {o.return_goods}</div>}
      {o.wish_date && <div className="sub">Kundenwunsch: {o.wish_date}</div>}

      <div className="row" style={{ marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label>Lieferdatum</label>
          <input type="date" value={o.plan_date || ''} onChange={(e) => act(() => send(pin, 'PATCH', { action: 'plan', id: o.id, plan_date: e.target.value })).catch(() => {})} />
        </div>
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
