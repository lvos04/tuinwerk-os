# Beheer en beveiliging

Gebruik uitsluitend persoonlijke accounts. Medewerkers mogen samenwerken aan taken, machines, locaties en voorraad; accounts en systeeminstellingen blijven beheerderswerk. Intrekbare sessies moeten na verlies van een telefoon direct worden beëindigd. Archiveren is de standaard voor historische gegevens.

De API is de autorisatiegrens. Verberg niet alleen knoppen: controleer rollen, privéplanning, bijlage-download en exportrechten op de server. Gebruik TLS, VPN als externe-toegangsdefault, sterke wachtwoorden en regelmatige beveiligingsupdates. Database is uitsluitend intern bereikbaar. Uploads zijn private bestanden via gecontroleerde API-download, nooit een openbaar uitvoerbaar pad.

Controleer vóór release: geen `.env`/tokens in Git, geen standaardaccounts, login-ratebegrenzing, verlopen/ingetrokken sessies, ongeldige en te grote uploads, path traversal, UUID-verwijzingen, medewerker die beheer probeert en gelijktijdige voorraadmutaties. Run `npm audit` en beoordeel kwetsbaarheden inhoudelijk; upgrade niet blind over breaking changes.

Stel bewaartermijnen en externe back-upretentie vast met de eigenaar. Wis gegevens niet zonder historische gevolgen te controleren. De huidige broncode en opleverstatus bepalen welke beheeracties daadwerkelijk ondersteund zijn. Tweede factor, malware-scanning, push en mail mogen niet als actief worden beschouwd zonder configuratie en concrete tests.

Externe AI is standaard uitgeschakeld. Inschakelen vereist providerconfiguratie, secrets buiten Git, expliciete toestemming per verzending en een beheerd budget. Gebruik geen externe diensten om bedrijfsdata te testen zonder toestemming. Push/mail/distributie hebben afzonderlijke account- en credentialvereisten.

Een nieuwe server vereist image-/broncodeversie, vastgelegde Custom App-invulvelden, secrets uit de kluis, versleuteld database/bestandenarchief en de externe decryptiesleutel. Volg BACKUP_HERSTEL.md en verander daarna DNS of configureerbare mobiele basis-URL. Houd oude server in alleen-lezen/stilgelegde staat om dubbele schrijvers te voorkomen.

## Optionele extra beveiliging (0.3)

Alle opties hieronder staan standaard zo dat het bestaande gedrag behouden blijft. Je vindt ze in **Beheer → Instellingen → Beveiliging beheerders**.

| Instelling | Standaard | Effect |
|---|---|---|
| Tweede factor (MFA) verplicht voor beheerders (`adminMfaRequired`) | uit | Beheerders zonder MFA kunnen alleen nog MFA instellen; beheerfuncties zijn geblokkeerd tot MFA aan staat. Zet eerst je eigen MFA aan. |
| Herbevestiging bij gevoelige acties (`sensitiveActionReauth`) | uit | Back-up terugzetten, volledige gegevensexport en koppelsleutel aanmaken vragen opnieuw om wachtwoord (of authenticatorcode bij MFA). Geldt 5 minuten per sessie. |
| Bedrijfskoppeling ingeschakeld (`koppelingEnabled`, in Beheer → Integraties) | uit | Zonder deze schakelaar weigert `/api/koppeling/v1/*` elk verzoek. |

Omgevingsvariabelen (optioneel):

| Variabele | Standaard | Betekenis |
|---|---|---|
| `TRUST_PROXY` | `loopback` | Welke proxy's `X-Forwarded-For` mogen zetten. Past bij de gebundelde nginx. Extra reverse proxy/Cloudflare-tunnel op een ander adres: voeg dat adres/subnet toe (`loopback,192.168.1.10`) of geef het aantal hops (`2`). Compose-ontwikkelopstelling: `loopback,uniquelocal`. |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_MAX_FAILURES_PER_IP` / `LOGIN_MAX_FAILURES_PER_ACCOUNT` | 10 / 50 / 30 per 15 min | Aanmeldbeperking per account+IP, per IP en per account. |
| `JSON_BODY_LIMIT` / `JSON_LARGE_BODY_LIMIT` | `1mb` / `9mb` | Maximale JSON-aanvraag; de grote limiet geldt alleen voor imports en telling bevestigen. |
| `WORKER_HEALTH_FILE` | `/tmp/tuinwerk-worker-health` | Hartslagbestand van de worker (healthcheck en Beheer-status). |
| `MIGRATION_CHECKSUM_MODE` | `warn` | `strict` laat de migratie stoppen als een al toegepaste migratie inhoudelijk is gewijzigd; standaard alleen een waarschuwing in de log. |

De worker ruimt dagelijks sessies op waarvan ook het vernieuwingstoken verlopen is. Auditlogs worden niet ingekort.

Migraties draaien in volgorde van de volledige bestandsnaam en worden op bestandsnaam geregistreerd met een SHA-256-checksum (`schema_migrations.checksum`). De twee historische bestanden met nummer `008` behouden hun naam omdat bestaande installaties ze onder die naam kennen; `008_operations_extensions.sql` loopt vóór `008_reporting_jobs.sql`. Nieuwe migraties krijgen altijd een uniek volgnummer (een test bewaakt dit). Wijzig nooit een toegepaste migratie: voeg een nieuwe toe.
