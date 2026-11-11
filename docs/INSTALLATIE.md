# Installeren met de standaard TrueNAS Custom App

**De gebruikersroute is één standaard Custom App via de TrueNAS-invulvelden. U hoeft geen YAML, Compose-bestand of apart database-applicatiebeheer te gebruiken.** De repository bouwt daarvoor één image met PostgreSQL, API, web, onderhoudsworker en interne HTTP-proxy. Een supervisor start en stopt de processen gecontroleerd. Compose in de repository is uitsluitend een ontwikkel-/testvoorziening.

## 1. Image beschikbaar maken

De workflow **Build Custom App image** publiceert na een handmatige GitHub Actions-run of een `v*`-releasetag naar `ghcr.io/lvos04/tuinwerk-os`. Kies de daadwerkelijk geslaagde immutable `sha-...`-tag of releasetag uit GitHub Packages. De aanwezigheid van deze workflow betekent niet dat een image al gepubliceerd is. Maak het package leesbaar voor TrueNAS (publiek of passende registrycredentials). De image is voor x86-64/amd64; andere architecturen zijn niet geclaimd.

## 2. Eén dataset

Maak via **Datasets → Add Dataset** bijvoorbeeld `apps/tuinwerk` in uw eigen pool. Deze dataset bevat `postgres`, `uploads`, `exports`, `backups` en `config`. Stel restrictieve ACL's in; geen algemene SMB-schrijftoegang. Het startproces initialiseert de interne rechten: PostgreSQL alleen zijn database, appgebruiker UID 1000 alleen uploads/exports. De container start als root voor procesbeheer en schakelt de diensten naar hun eigen gebruikers. Privileged mode en host networking zijn niet nodig.

## 3. Custom App-invulvelden

Ga naar **Apps → Discover Apps → Custom App** (benaming kan per SCALE-versie verschillen) en vul de standaard wizard in:

| Veld | Waarde |
|---|---|
| Application name | `tuinwerk` |
| Image repository | `ghcr.io/lvos04/tuinwerk-os` |
| Image tag | De werkelijk gepubliceerde versie of `sha-...` |
| Pull policy | If Not Present voor immutable tags |
| Entrypoint/command | Leeg laten |
| Container port | `8080`, TCP |
| Host port | Vrije poort, bijvoorbeeld `30080` |
| Storage type | Host Path |
| Host path | Uw datasetpad, bijvoorbeeld `/mnt/uwpool/apps/tuinwerk` |
| Mount path | `/data`, schrijfbaar |
| Custom User | Uit; image start supervisor als root, diensten als eigen gebruikers |
| Disable Builtin Healthcheck | Uit; behoud de ingebouwde controle |
| Privileged | Uit |
| Host network | Uit |
| Restart policy | Unless stopped / standaard herstartbeleid |

Voeg omgevingsvariabelen toe via **Add Environment Variable**:

| Naam | Waarde |
|---|---|
| `APP_URL` | Publieke/interne HTTPS-URL van uw proxy |
| `CORS_ORIGINS` | Dezelfde HTTPS-origin |
| `ADMIN_EMAIL` | Eerste beheerder e-mailadres |
| `ADMIN_NAME` | Naam beheerder |
| `ADMIN_PASSWORD` | Uniek sterk wachtwoord, minimaal 12 tekens |
| `AI_ENABLED` | `false` |
| `APP_TIMEZONE` | `Europe/Amsterdam` |
| `TOTP_ENCRYPTION_KEY` | Optioneel exact 64 hextekens uit `openssl rand -hex 32`, voor beheerder-2FA |
| `RECURRENCE_LOOKAHEAD_DAYS` | `28` |
| `AGE_RECIPIENT` | Optioneel publieke age-ontvanger voor back-ups |
| `BACKUP_RETENTION_APPLY` | `false`; pas na geteste dry-run eventueel `true` |
| `BACKUP_KEEP_DAILY` / `BACKUP_KEEP_MONTHLY` | `30` / `12` |

Klik **Install**. De container maakt een lege database aan, voert migraties uit en creëert een eerste beheerder zonder bestaand account te overschrijven. Verwijder `ADMIN_PASSWORD` na succesvolle eerste login uit de appconfiguratie en sla opnieuw op. Er is geen standaardwachtwoord. Maak voor medewerkers persoonlijke accounts.

## 4. Toegang en controle

Open aanvankelijk via uw vertrouwde LAN/VPN `http://NAS-IP:30080`. Gebruik voor normale werking een bestaande HTTPS-reverse-proxy naar die poort; stel `APP_URL` en `CORS_ORIGINS` daarop af. Open de HTTP-poort niet rechtstreeks naar internet. Deze image beheert geen DNS of TLS-certificaten; maak een geldige HTTPS-route vóór mobiele productie. PostgreSQL en interne web/API-poorten luisteren alleen binnen de container en worden niet gepubliceerd. Gebruik nooit TrueNAS-beheercredentials als appwachtwoord.

Controleer healthstatus/logs in Apps, login, taak met foto, voorraadverbruik en onderhoudsbeurt. Herstart de app en controleer dat alles terugkomt. Test offline synchronisatie op echte medewerkersapparaten. Wijs daarna de native apps naar de configureerbare HTTPS API-URL.

## Updates en herstel

Maak eerst een gecontroleerde versleutelde back-up en noteer image-tag en tijd. Wijzig daarna alleen de image-tag in **Edit Custom App** naar een geteste release; bewaar dezelfde `/data`-mount. Migraties worden transactioneel uitgevoerd. Een oude image bij een nieuw schema is geen veilige rollback: herstel op een nieuwe dataset met de passende image en back-up. Zie BACKUP_HERSTEL.md. Verwijder nooit de dataset bij een normale appupdate.

## Technische keuze

De functionele specificatie adviseert afzonderlijke containers. De expliciete gebruikerskeuze voor één standaard Custom App zonder YAML is doorslaggevend: processen zijn daarom in één beheerde image samengevoegd. Daardoor worden database en app samen bijgewerkt en deelt de app één containergrens. PostgreSQL 17 wordt uit Alpine 3.22 gebruikt; major-upgrades gebeuren via logische back-up/herstel, niet door een bestaande datadirectory onder een andere major te openen. Geen Docker-socketmount of privileged container nodig.

De werkelijke TrueNAS GUI-installatie en herstelduur moeten op de doel-NAS worden gevalideerd; een lokale image-test is geen bewijs van die fysieke productieacceptatie.

## Optionele transporten

Voeg alleen na configuratie via dezelfde GUI envvelden toe: SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (false), SMTP_REQUIRE_TLS (true), SMTP_USER, SMTP_PASSWORD en SMTP_FROM voor e-mail; EXPO_PUSH_ENABLED=true en indien vereist EXPO_ACCESS_TOKEN voor native push. Zonder transport blijft de kernapp bruikbaar met in-appmeldingen. Echte bezorging vereist een afzonderlijke test. AI blijft uit tenzij AI_ENABLED=true en AI_BASE_URL (HTTPS OpenAI-compatible /v1), AI_MODEL, AI_API_KEY, AI_DAILY_TOKEN_BUDGET, AI_DAILY_BUDGET_EUR, AI_INPUT_EUR_PER_MILLION en AI_OUTPUT_EUR_PER_MILLION bewust zijn ingesteld. Deel alleen na expliciete gebruikersbevestiging. Secrets horen uitsluitend in de beschermde appconfiguratie.

Bron voor de invulvelden: [TrueNAS Custom App Screens](https://www.truenas.com/docs/scale/apps/installcustomappscreens/) (geraadpleegd 11 november 2026). De documentatie onderscheidt **Custom App → Install Custom App** (guided wizard) van **Install via YAML**; gebruik de guided wizard.

Bewaar `TOTP_ENCRYPTION_KEY` afzonderlijk in de secretskluis en herstel die ongewijzigd op de nieuwe server. Verlies van de sleutel maakt bestaande 2FA-geheimen onleesbaar; databaseback-up alleen volstaat niet. Zonder sleutel is optionele 2FA niet beschikbaar.
