# Transportplanung – Einrichtung Schritt für Schritt

Sie brauchen drei kostenlose Konten: **Supabase** (Daten und Fotos), **Resend** (E-Mails), **Vercel** (damit die App im Internet läuft). Dazu ein kostenloses **GitHub**-Konto, über das Vercel den Code bekommt.

## 1. Supabase (Datenbank und Fotospeicher)
1. Auf supabase.com registrieren, **New project** wählen, Namen vergeben, ein Datenbank-Passwort setzen und eine Region in Europa wählen (z. B. Frankfurt oder Zürich). Warten, bis das Projekt bereit ist.
2. Links **SQL Editor** → **New query**. Den ganzen Inhalt der Datei `supabase.sql` einfügen und **Run** drücken. Das legt die Tabelle an und erstellt den Foto-Speicher `ablieferfotos`.
3. Kontrolle: Links **Storage** – dort muss der Bucket `ablieferfotos` stehen. Falls nicht: **New bucket**, Name `ablieferfotos`, **Public bucket** einschalten.
4. Links **Project Settings → API**. Notieren Sie:
   - **Project URL** → wird `SUPABASE_URL`
   - **service_role key** (unter «API Keys», «Reveal» klicken) → wird `SUPABASE_SERVICE_ROLE_KEY`. Dieser Schlüssel ist geheim, nie weitergeben.

## 2. Resend (E-Mails)
1. Auf resend.com registrieren (mit Ihrer Büro-E-Mail-Adresse).
2. **API Keys → Create API Key**, Berechtigung «Sending access». Den Key (beginnt mit `re_`) kopieren → `RESEND_API_KEY`.
3. Ohne eigene Domain können Sie nur an die E-Mail-Adresse senden, mit der Sie sich bei Resend registriert haben. Das reicht zum Start: `MAIL_TO` = diese Adresse, `MAIL_FROM` = `Transportplanung <onboarding@resend.dev>`.
4. Später an eine beliebige Adresse senden: In Resend unter **Domains** Ihre Domain hinzufügen und die angezeigten DNS-Einträge bei Ihrem Domain-Anbieter eintragen. Danach z. B. `MAIL_FROM` = `Transportplanung <transport@ihre-domain.ch>`.

## 3. Code auf GitHub legen
1. Auf github.com registrieren, **New repository** (Name `transportplanung`, **Private**).
2. Das ZIP entpacken. Im neuen Repository **uploading an existing file** wählen und den **Inhalt** des Ordners `transportplanung` hineinziehen (die Ordner `app`, `lib` und die Dateien `package.json` usw.). **Commit changes**.

## 4. Vercel (App veröffentlichen)
1. Auf vercel.com mit GitHub anmelden, **Add New → Project**, das Repository `transportplanung` importieren.
2. Vor dem Deploy **Environment Variables** öffnen und diese eintragen:

| Name | Wert |
|---|---|
| `SUPABASE_URL` | Project URL aus Schritt 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key aus Schritt 1 |
| `BUERO_PIN` | 4 Ziffern für das Büro |
| `CHAUFFEUR_PIN` | 4 andere Ziffern für den Chauffeur |
| `RESEND_API_KEY` | Key aus Schritt 2 |
| `MAIL_TO` | Adresse, die die Meldungen erhält |
| `MAIL_FROM` | `Transportplanung <onboarding@resend.dev>` |

3. **Deploy** drücken. Nach ca. 1–2 Minuten erhalten Sie eine Adresse wie `https://transportplanung-xyz.vercel.app`.
4. Ihre Links:
   - Büro: `https://IHRE-ADRESSE.vercel.app/?role=buero`
   - Chauffeur: `https://IHRE-ADRESSE.vercel.app/?role=chauffeur`
5. Änderungen an Variablen (z. B. PIN) wirken erst nach einem **Redeploy** (Vercel → Deployments → ⋯ → Redeploy).

## 5. Erster Test
1. Büro-Link öffnen, PIN eingeben, einen Testauftrag erfassen.
2. Chauffeur-Link auf dem Handy öffnen, PIN eingeben. Datum wählen, **Tagesroute in Google Maps öffnen** prüfen.
3. Auftrag ablehnen → rotes Banner im Büro und E-Mail `ABGELEHNT: …`. Zweiten Auftrag mit Foto erledigen → E-Mail `ERLEDIGT: …` mit Fotolink.
4. Neue Aufträge erscheinen auf dem anderen Gerät innerhalb von ca. 5 Sekunden (die App fragt automatisch nach).

## 6. Als Icon auf dem Handy-Startbildschirm
- **iPhone (Safari):** Chauffeur-Link öffnen und PIN einmal eingeben → Teilen-Symbol → **Zum Home-Bildschirm** → **Hinzufügen**.
- **Android (Chrome):** Chauffeur-Link öffnen → Menü ⋮ → **Zum Startbildschirm hinzufügen** (oder «App installieren»).
Wichtig: Den Link mit `?role=chauffeur` öffnen, bevor Sie das Icon anlegen. Die PIN bleibt auf dem Gerät gespeichert, bis man «Abmelden» drückt.

## Lokal testen (optional)
Node.js installieren, Datei `.env.example` nach `.env.local` kopieren und ausfüllen, dann `npm install` und `npm run dev`. Aufruf: `http://localhost:3000/?role=buero`.

## Gut zu wissen
- Die PIN wird auf dem Server geprüft, und Kundendaten werden nur nach korrekter PIN ausgeliefert. Ein 4-stelliger PIN ist trotzdem nur ein einfacher Schutz. Wählen Sie keine Zahl wie 1234.
- Ablieferfotos sind über ihren (nicht erratbaren) Link abrufbar. Wer den Link aus der E-Mail hat, sieht das Foto.
- Die Google-Maps-Tagesroute startet beim aktuellen Standort des Chauffeurs und fährt die Stopps in seiner Reihenfolge an.
- Free-Pläne: Supabase pausiert Projekte nach längerer Inaktivität (ca. 1 Woche ohne Nutzung); im Alltag ist das kein Problem, nach einer Pause einfach im Dashboard reaktivieren.

---

# Update: Rolle «Kasse» (Verkäufer)

Die Kasse erfasst Aufträge mit Artikeln und Preisen, sieht die bestehenden Aufträge nur zum Lesen und kann Aufträge drucken. Neue Aufträge der Kasse erscheinen im Büro als «Pendent».

## 1. Supabase aktualisieren
1. Supabase, **SQL Editor**, **New query**.
2. Den ganzen Inhalt der Datei `supabase-update-kasse.sql` einfügen und **Run** drücken. Es muss «Success» erscheinen. Bestehende Aufträge bleiben erhalten.

## 2. Dateien auf GitHub ersetzen
Öffnen Sie jede Datei auf GitHub, klicken Sie auf das **Stift-Symbol**, markieren Sie den ganzen Inhalt (Strg + A), fügen Sie den neuen Inhalt ein und drücken Sie **Commit changes**:

| Datei auf GitHub | Neue Version |
|---|---|
| `app/page.js` | `app_page.js` |
| `app/globals.css` | `app_globals.css` |
| `app/api/orders/route.js` | `app_api_orders_route.js` |
| `lib/server.js` | `lib_server.js` |
| `app/api/prices/route.js` (**neu**) | `app_api_prices_route.js` |

Die neue Datei legen Sie so an: **Add file**, **Create new file**, Namen `app/api/prices/route.js` tippen, Inhalt einfügen, **Commit changes**.

## 3. Vercel
1. **Settings**, **Environment Variables**, neu hinzufügen:
   - `KASSE_PIN` = 4 Ziffern für die Kasse (anders als die anderen PINs)
   - `NEXT_PUBLIC_FIRMENNAME` = Name Ihrer Gärtnerei (erscheint auf dem Ausdruck, optional)
2. **Deployments**, beim obersten Eintrag **⋯**, **Redeploy**.

## 4. Transportpreise erfassen
Büro-Link öffnen, ganz unten bei **Einstellungen** auf **Transportpreise pro PLZ** klicken. PLZ, Ort und Preis eintragen, **Speichern**. Die Kasse berechnet die Transportkosten damit automatisch. Ist für eine PLZ kein Preis hinterlegt, steht dort «für diese PLZ nicht hinterlegt».

## 5. Kasse benutzen
- Link: `https://IHRE-ADRESSE.vercel.app/?role=kasse`
- **Neuer Auftrag**, ausfüllen, **Speichern**. Der Auftrag geht pendent ans Büro.
- **Auftrag drucken** öffnet den Druckdialog des Computers. Wählen Sie den Drucker. Der Ausdruck enthält alle Angaben, die Artikel mit Bemerkungen, die Preise und ein Unterschriftsfeld.

## Ablauf im Büro
- Pendente Aufträge stehen oben und sind blau markiert. Mit **Bearbeiten** ergänzen Sie sie.
- **Für Chauffeur freigeben** schaltet den Auftrag für den Chauffeur frei (nur bei Transport).
- Bei **Abholung** sieht der Chauffeur den Auftrag nicht. Mit **Abgeholt / erledigt** schliessen Sie ihn ab.
- Der Chauffeur sieht die Artikel mit Menge und Bemerkung, aber keine Preise und keine E-Mail-Adresse.
