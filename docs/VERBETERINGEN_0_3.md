# Verbeteringen in TuinWerk OS 0.3

Deze ronde voert het verbeterplan uit (beveiliging, onderhoud, prestaties en codekwaliteit). Uitgangspunt: **alles wat
gedrag voor gebruikers of beheerders verandert is optioneel** en staat standaard zo dat het bestaande gedrag blijft.

## Nieuwe instellingen

| Instelling | Waar | Standaard |
|---|---|---|
| Tweede factor (MFA) verplicht voor beheerders | Beheer → Instellingen → Beveiliging beheerders | uit |
| Herbevestiging bij gevoelige acties (back-up terugzetten, volledige export, koppelsleutel aanmaken) | Beheer → Instellingen → Beveiliging beheerders | uit |
| Bedrijfskoppeling ingeschakeld | Beheer → Integraties → Bedrijfskoppeling | uit |
| `TRUST_PROXY` (vertrouwde proxy voor het client-IP) | omgevingsvariabele | `loopback` (gebundelde nginx) |
| `LOGIN_MAX_ATTEMPTS`, `LOGIN_MAX_FAILURES_PER_IP`, `LOGIN_MAX_FAILURES_PER_ACCOUNT` | omgevingsvariabele | 10 / 50 / 30 per 15 minuten |
| `JSON_BODY_LIMIT`, `JSON_LARGE_BODY_LIMIT` | omgevingsvariabele | 1 MB / 9 MB (alleen imports en telling bevestigen) |
| `WORKER_HEALTH_FILE` | omgevingsvariabele | `/tmp/tuinwerk-worker-health` |
| `MIGRATION_CHECKSUM_MODE` | omgevingsvariabele | `warn` (`strict` = stoppen) |

Let op: de Bedrijfskoppeling (nieuw in deze branch) staat standaard uit. Zet de schakelaar aan voordat het
Bedrijfsdashboard gegevens kan ophalen.

## Wijzigingen

* **Aanmelden**: de API vertrouwt `X-Forwarded-For` alleen van de ingestelde proxy (standaard loopback), zodat één
  persoon met foute wachtwoorden niet langer iedereen achter dezelfde proxy blokkeert. Beperking per account+IP, per
  IP en per account, met oplopende vertraging (max. 2 s).
* **MFA en herbevestiging**: zie de instellingen hierboven; `POST /api/auth/reauth` bevestigt opnieuw met wachtwoord of
  authenticatorcode (geldig 5 minuten in die sessie).
* **Aanvraaggrootte**: standaard 1 MB JSON in plaats van 9 MB op alle routes; alleen imports en het bevestigen van een
  telling krijgen de grote limiet. Te groot → `413`.
* **Opschonen**: de worker verwijdert dagelijks sessies waarvan het vernieuwingstoken verlopen is. Auditlogs blijven
  onbeperkt bewaard.
* **Voorraad**: `inventory_balances.updated_at` (migratie `021`, met trigger); een gewijzigd locatieminimum verschijnt
  nu in koppeling-dataset `voorraad` via `sinds`.
* **Migraties**: checksumregistratie in `schema_migrations.checksum` en een vaste volgorde-regel (volledige
  bestandsnaam). De historische dubbele `008`-bestanden zijn bewust niet hernummerd, omdat bestaande installaties ze op
  bestandsnaam hebben geregistreerd. Gewijzigde toegepaste migraties geven een waarschuwing (of fout met `strict`).
* **Rapportage**: `GET /api/reports/summary` telt in SQL in plaats van alle taken in het geheugen te laden.
* **Indexen**: `time_entries(started_at)`, `time_entries(task_id)`, `sessions(user_id)`, `sessions(refresh_expires_at)`,
  `tasks(category)`, `inventory_balances(updated_at)`.
* **Beheer-status**: het pad van de worker-hartslag is instelbaar (`WORKER_HEALTH_FILE`), ook in de healthcheck.
* **Codekwaliteit**: de webinterface is per scherm opgesplitst, ESLint en `prettier --check` draaien in CI, en de
  Swagger-versie komt uit `APP_VERSION`.
* **Images**: handmatig starten van *Build Custom App image* vanaf een andere branch dan `main` levert
  `0.3.0-rc.<run>`, `branch-<naam>` en `sha-<kort>` op en overschrijft nooit `latest`.
