# Bedrijfskoppeling API v1 — TuinWerk OS

Alleen-lezen server-naar-server API waarmee het Bedrijfsdashboard (en andere bedrijfsapps) kerncijfers en
datasets van TuinWerk OS ophaalt. Deze implementatie volgt het gedeelde contract *Bedrijfskoppeling API v1*;
dit document beschrijft het contract en de app-specifieke KPI's en datasets.

* App-slug: `tuinwerk-os`
* Pad-prefix: **`/api/koppeling/v1`** (de app gebruikt globaal `/api`; de koppelroutes staan daar exact onder).
* Alleen `GET`, JSON (UTF-8). Tijden ISO 8601 in UTC (`Z`), datums `JJJJ-MM-DD`.
* Ontbrekende waarde = `null`, nooit een verzonnen 0. Voorraadaantallen zijn string-getallen (`"12.5"`),
  omdat de database ze als decimaal opslaat.
* Alle antwoorden hebben `Cache-Control: no-store`.

## Authenticatie: koppelsleutels

`Authorization: Bearer bk_…`. Zonder sleutel, met een onbekende of ingetrokken sleutel, of met een gewone
gebruikerssessie → `401 {"fout": "ongeldige_koppelsleutel"}`. Koppelsleutels werken omgekeerd niet op de
gewone API.

* Sleutel = `bk_` + 32 cryptografisch willekeurige bytes (base64url, totaal 46 tekens).
* De database (`koppelsleutels`, migratie `020_koppelsleutels.sql`) bewaart alleen de **SHA-256-hash** en de
  eerste 8 tekens als `voorvoegsel`. Opzoeken gebeurt via de hash.
* Velden: `id`, `naam`, `voorvoegsel`, `sleutel_hash`, `aangemaakt_op`, `aangemaakt_door`, `laatst_gebruikt_op`
  (bijgewerkt met maximaal één schrijfactie per minuut), `ingetrokken_op`, `ingetrokken_door`.
* Rate limit: 120 verzoeken per minuut per sleutel (in het geheugen van het API-proces) →
  `429 {"fout": "te_veel_verzoeken"}`.
* Maximaal 25 actieve sleutels tegelijk.

### Beheer (alleen beheerders)

Via de bestaande beheer-API met de normale sessie-auth (`Authorization: Bearer <sessietoken>`, rol `admin`).
De web-app gebruikt Bearer-tokens in plaats van cookies, dus CSRF is niet van toepassing. Er geldt geen
aparte MFA-eis voor beheer; een beheerder met ingeschakelde tweede factor heeft die al bij het inloggen gebruikt.

| Methode | Pad | Resultaat |
| --- | --- | --- |
| `GET` | `/api/admin/koppelsleutels` | Lijst met `id, naam, voorvoegsel, aangemaakt_op, aangemaakt_door` (weergavenaam), `aangemaakt_door_id, laatst_gebruikt_op, ingetrokken_op`. Nooit de sleutel of hash. |
| `POST` | `/api/admin/koppelsleutels` `{"naam": "Bedrijfsdashboard"}` | `201` met eenmalig het veld `sleutel`. Daarna is de sleutel niet meer op te vragen. |
| `DELETE` | `/api/admin/koppelsleutels/{id}` | Trekt de sleutel direct in (idempotent); `404` bij onbekend id. |

Medewerkers krijgen `403`, zonder sessie `401`. Aanmaken en intrekken worden vastgelegd in `audit_events`
(`entity_type = 'koppelsleutel'`, acties `created` / `revoked`, met naam en voorvoegsel, nooit de sleutel).

In de web-app: **Beheer → Integraties → Bedrijfskoppeling** (aanmaken, eenmalig kopiëren, intrekken, laatst gebruikt).

## Endpoints

### `GET /api/koppeling/v1/info`

```json
{
  "app": "tuinwerk-os",
  "naam": "TuinWerk OS",
  "versie": "0.2.0",
  "api_versie": "1",
  "bedrijf": "Bedrijfsnaam uit Beheer → Instellingen of null",
  "datasets": ["samenvatting", "storingen", "onderhoudstaken", "voorraad", "planning"],
  "tijd": "2026-11-16T15:00:00.000Z"
}
```

`versie` komt uit `APP_VERSION` (gezet in het Custom App-image) of anders `apps/api/package.json`.

### `GET /api/koppeling/v1/samenvatting`

`{app, gegenereerd_op, kpis[], meldingen[]}`. KPI-status: `ok | let_op | actie | onbekend`; meldingniveau:
`info | waarschuwing | kritiek`. Meldingen zijn gesorteerd van kritiek naar info. Taken die door moderatie
verborgen zijn tellen nergens mee.

| `sleutel` | Waarde | Status |
| --- | --- | --- |
| `open_storingen` | Aantal niet-afgeronde taken met categorie `reparatie` of `storing`. Toelichting noemt kritiek/hoog. | `actie` bij ≥1 kritiek, `let_op` bij ≥1 hoog, anders `ok`. |
| `achterstallig_onderhoud` | Niet-afgerond onderhoud (categorie `onderhoud` of gekoppeld aan een herhaalregel) met deadline in het verleden. | `actie` als iets >7 dagen over de deadline is, `let_op` bij ≥1, anders `ok`. |
| `geblokkeerde_taken` | Taken met status geblokkeerd. | `let_op` bij ≥1. |
| `planning_bezetting_week` | Geplande minuten (samengevoegde planningsblokken per medewerker) / ingestelde capaciteit, maandag t/m zondag in de app-tijdzone, in `%`. | `onbekend` (waarde `null`) zonder capaciteit; `actie` >100%; `let_op` >85% of als een medewerker op een dag overbelast is. |
| `onderdelen_onder_minimum` | Actieve artikelen waarvan de totale voorraad onder het artikelminimum ligt of een locatie onder het locatieminimum. | `actie` als er een op 0 staat, `let_op` bij ≥1. |
| `uren_deze_week` | Afgesloten tijdregistraties die deze week startten, in uren (1 decimaal). Toelichting meldt lopende timers. | Altijd `ok` (informatief). |
| `afgeronde_taken_7d` | Taken afgerond in de afgelopen 7 dagen. | Altijd `ok`. |
| `backup_gezondheid` | Uren sinds de laatste geslaagde lokale back-up (`null` als er nog geen is). Toelichting = belangrijkste back-upwaarschuwing. | Volgt de bestaande back-upgezondheid: kritieke melding → `actie`, waarschuwing/info → `let_op`; `onbekend` als de status niet te bepalen is. |

Meldingen: kritieke storingen (`sinds` = oudste melding), achterstallig onderhoud (`sinds` = oudste deadline),
overbelaste planningsdagen, onderdelen onder minimum en alle back-upmeldingen uit de back-upgezondheid
(helper niet bereikbaar, back-up te oud of mislukt, OneDrive, schijfruimte, herstelcontrole).

### `GET /api/koppeling/v1/datasets/{naam}?sinds=<ISO>&limiet=<1..500>&cursor=<opaak>`

`{app, dataset, gegenereerd_op, items[], volgende_cursor}`.

* `limiet`: geheel getal 1–500, standaard 100.
* `sinds`: ISO 8601-tijd **met** tijdzone (`2026-11-16T15:00:00Z`, `…+01:00`) of een datum `JJJJ-MM-DD`.
  Geeft items met `bijgewerkt_op >= sinds`.
* `cursor`: neem `volgende_cursor` ongewijzigd over (met dezelfde `sinds`). `null` = laatste pagina.
* Sortering: `bijgewerkt_op` oplopend, dan `id` (keyset-paginering, stabiel bij gelijke tijden).
* Fouten: onbekende dataset → `404 {"fout": "onbekende_dataset"}`; ongeldige parameter →
  `422 {"fout": "ongeldige_parameter", "melding": "…"}`.

Taakstatussen worden als Nederlandse codes geleverd: `open, gepland, in_uitvoering, geblokkeerd, afgerond,
geannuleerd, gearchiveerd`; prioriteiten `laag, normaal, hoog, kritiek`.

#### `storingen`
Taken met categorie `reparatie` of `storing` (geen door moderatie verborgen taken).
`id, titel, status, prioriteit, categorie, machine_id, machine, locatie_id, locatie, gemeld_op, deadline,
afgerond_op, bijgewerkt_op`.

#### `onderhoudstaken`
Taken met categorie `onderhoud` of gekoppeld aan een herhaalregel.
`id, titel, status, prioriteit, machine_id, machine, locatie_id, locatie, herhaalregel_id, gepland_op, deadline,
achterstallig, geschatte_minuten, afgerond_op, bijgewerkt_op`.

#### `voorraad`
Alle artikelen (ook inactieve, zodat het dashboard deactivering via `sinds` ziet).
`id, sku, naam, categorie, eenheid, voorraad, minimum, onder_minimum, leverancier, actief, bijgewerkt_op`.
`bijgewerkt_op` = laatste wijziging van het artikel of laatste voorraadmutatie. Een gewijzigd
locatieminimum zonder mutatie verschuift `bijgewerkt_op` niet.

#### `planning`
Berekende capaciteit per kalenderdag (app-tijdzone), **zonder** gegevens per medewerker. Venster van 28 dagen
vanaf maandag van de huidige week, of vanaf de datum van `sinds`. `limiet`/`cursor` pagineren binnen dat
venster. `id` = `datum`, `bijgewerkt_op` = `null` (berekend).
`id, datum, capaciteit_minuten, gepland_minuten, overbelast_minuten, bezetting_procent, medewerkers_beschikbaar,
medewerkers_overbelast, bijgewerkt_op`.

#### `samenvatting`
De KPI's van `/samenvatting` als items (`id` = `sleutel`, `bijgewerkt_op` = `gegenereerd_op`).

### Privacy

Geen wachtwoorden, tokens, e-mailadressen, telefoonnummers, taakomschrijvingen, reacties, tijdregistratie-notities,
bijlagen of namen van medewerkers. Taaktitels, machine- en locatienamen worden wel gedeeld omdat het dashboard ze
als label nodig heeft; houd persoonsgegevens daarom uit taaktitels. De enige weergavenaam (`aangemaakt_door`)
staat in de beheerlijst van koppelsleutels, niet in de koppeling zelf.

## Voorbeeld

```bash
curl -H "Authorization: Bearer $KOPPELSLEUTEL" https://tuinwerk.example/api/koppeling/v1/samenvatting
curl -H "Authorization: Bearer $KOPPELSLEUTEL" \
  "https://tuinwerk.example/api/koppeling/v1/datasets/storingen?sinds=2026-11-01T00:00:00Z&limiet=200"
```

## Tests

`apps/api/test/koppeling.integration.test.ts` (draait met `DATABASE_URL`): 401 zonder/ongeldige/ingetrokken
sleutel en met sessietoken, aanmaken (eenmalig tonen, alleen hash opgeslagen, audit), info/samenvatting-vorm,
datasets met `limiet`/`sinds`/`cursor`, privacy, 404 onbekende dataset, 422 ongeldige parameters, rate limit en
dat medewerkers geen sleutels kunnen beheren.
