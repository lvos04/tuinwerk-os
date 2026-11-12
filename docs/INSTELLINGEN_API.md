# Eerste installatie en instellingen

De TrueNAS-image bewaart alle applicatie-instellingen in PostgreSQL en de versleutelingssleutels in de configuratiemap. De beheerder hoeft geen SMTP-, AI-, push- of TOTP-omgevingsvariabelen in TrueNAS in te vullen. Instellingen worden via de webapp beheerd; de API en worker verversen ze binnen ongeveer twee seconden. Een al lopende externe aanvraag kan nog de vorige configuratie gebruiken.

## Eerste beheerder

`GET /api/setup` geeft `{required, requiresSetupCode}`. Beide zijn alleen waar als er nog geen enkele gebruiker bestaat en de installatie niet expliciet is uitgeschakeld. De respons bevat nooit de installatiecode. Bij de eerste start wordt een willekeurige code aangemaakt in `config/setup-token` (bestandseigenschappen 0600). Zolang de installatie niet is voltooid, wordt dezelfde code bij iedere processtart opnieuw in de applicatielogs getoond. De beheerder kopieert deze uit **TrueNAS → Apps → TuinWerk → Logs** naar de installatiepagina. Hiervoor is geen shell of extra omgevingsvariabele nodig.

`POST /api/setup {setupCode,name,email,password,companyName?,appUrl?}` maakt transactioneel precies één eerste beheerder. Een PostgreSQL-advisorylock voorkomt gelijktijdige claims. Een foutieve code werkt niet; na vijf pogingen per bronadres volgt een blokkade van vijftien minuten. Wachtwoorden moeten 12–256 tekens bevatten. Na succes wordt het codebestand verwijderd en is installatie gesloten, ook als later alle accounts worden gedeactiveerd. De gebruiker meldt zich daarna via de normale inlogpagina aan. De webwizard stuurt het huidige browseradres als `appUrl` mee; de API valideert dit expliciete adres en bewaart het in dezelfde transactie, zodat QR-labels direct naar de juiste NAS verwijzen. De server vertrouwt hiervoor geen doorgezonden hostheader.

## Beheerinstellingen

Alleen beheerders mogen `GET /api/settings` en `PATCH /api/settings` gebruiken. GET retourneert `{version,values,configured,updatedAt}`. `configured` bevat uitsluitend booleans die aangeven of een geheim aanwezig is. Geheimen worden nooit teruggestuurd. Antwoorden hebben `Cache-Control: no-store`.

PATCH accepteert `{version,values:{...gewijzigdeVelden},secrets:{...nieuweGeheimen},clearSecrets:[...explicietWissen]}`. Een oudere versie krijgt HTTP 409. Ontbrekende geheimen blijven behouden; een lege string wist niets en wordt afgewezen. Alleen `clearSecrets` wist een configureerbaar geheim, inclusief eventuele legacy-omgevingsvariabelefallback. Audit bevat veldnamen, nooit geheimwaarden.

Publiek wijzigbare instellingen:

- Bedrijf: `companyName`, `appUrl`, `corsOrigins` (array met origins), `appTimezone` (IANA-tijdzone).
- E-mail: `smtpHost`, `smtpPort`, `smtpSecure`, `smtpRequireTls`, `smtpUser`, `smtpFrom`; geheim `smtpPassword`.
- AI: `aiEnabled`, `aiBaseUrl` (HTTPS), `aiModel`, `aiDailyTokenBudget`, `aiDailyBudgetEur`, `aiInputEurPerMillion`, `aiOutputEurPerMillion`; geheim `aiApiKey`.
- Push: `pushEnabled`; geheim `expoAccessToken`.
- Gebruik: `maxUploadBytes` (1 KiB–50 MiB), `recurrenceLookaheadDays` (0–366 dagen).
- OneDrive: `oneDriveClientId`, `oneDriveTenantId`, `oneDriveFolder`. Aanmelden/afmelden gebruikt de speciale OneDrive-controller. De interne refresh-token kan niet via generieke instellingen worden gelezen, vervangen of gewist.

Back-upvelden zijn in de snapshot zichtbaar, maar kunnen uitsluitend via de speciale back-upconfiguratie worden gewijzigd. Dat bewaakt herstelcodebevestiging voordat automatische back-ups worden geactiveerd. `backupPassphrase` en `oneDriveRefreshToken` zijn interne geheimen; generieke PATCH weigert deze.

## Sleutels, herstart en herstel

`settings.key` bevat een automatisch aangemaakte 256-bit hoofdsleutel. Instellingengeheimen gebruiken AES-256-GCM met afgeleide sleutel en veldnaam als authenticatiecontext. `totp.key` wordt eveneens automatisch aangemaakt; een bestaande `TOTP_ENCRYPTION_KEY` wordt bij de eerste start daarin overgenomen. Beide bestanden zijn eigendom van het Node-account en krijgen modus 0600. Publicatie gebeurt atomair zodat API en worker nooit een half geschreven sleutel lezen.

De image gebruikt `/data/config`. Voor ontwikkeling kan `SETTINGS_DIR` worden gebruikt; zonder `/data` is de standaard `config/` onder de huidige werkmap. `SETTINGS_KEY_FILE` is een expliciete pad-override. Deze configuratiepaden zijn infrastructuurinstellingen en worden niet via een gebruikersformulier gewijzigd.

Bestaande ondersteunde omgevingsvariabelen worden bij starten eenmaal naar de database overgenomen als het veld daar nog niet bestaat. Dit geldt ook voor SMTP/AI/push-geheimen. Daarna zijn de databasewaarden leidend, zodat een volledige back-up ook zonder dezelfde omgevingsvariabelen herstelbaar is. Bewuste verwijderingen blijven verwijderd.

Een volledige back-up moet database, uploads, exports en de gehele configuratiemap bevatten. Alleen een database-export is onvoldoende om versleutelde instellingen of TOTP te herstellen. Bij een bestaande versleutelde database zonder sleutel start de applicatie niet stilzwijgend met een nieuwe sleutel: eerst de configuratiemap herstellen. De aparte herstelcode voor het back-uparchief hoort buiten de NAS te worden bewaard.

## Verificatie

`test/settings.integration.test.ts` maakt een afzonderlijke PostgreSQL-database. Het scenario controleert installatiecode, rate-limit, eerste-admin-race, herstart vóór installatie, bestandsrechten, geheimredactie, auditredactie, versleutelde databaseopslag, echte subprocess-herstart zonder legacy-geheimen, medewerkerrechten, versieconflicten, expliciet wissen, dynamische CORS en aangepaste uploadlimiet zonder serverherstart. Bestaande projectgegevens worden niet leeggemaakt.
