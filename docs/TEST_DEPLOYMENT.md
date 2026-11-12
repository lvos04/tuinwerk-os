# Uitgevoerde installatie- en herstelproef

Datum: **11 november 2026**, managed Linux/Docker-omgeving. Uitgevoerd door deployment-subagent, met onafhankelijke broncodereview door reporting-subagent. Dit is een feitelijk verslag; het is geen claim van installatie op de gebruiker zijn TrueNAS of telefoons.

## Nieuwe volledige UI/API-herstelproef — 12 november 2026

De nieuwe route is op twee achtereenvolgende, afzonderlijke lege runtimevolumes getest, zonder `ADMIN_*`-omgevingsvariabelen. De eerste beheerder is via de setup-API aangemaakt met de automatisch gegenereerde eenmalige code uit het beheerderslog. Instellingen, een geheim SMTP-testwachtwoord en de back-upherstelcode zijn via de geautoriseerde beheer-API opgeslagen. Het geheim is uitsluitend als testfixture gebruikt; er is geen externe SMTP-dienst aangeroepen.

De echte root-helper maakte vervolgens een volledig `.twb`-archief met database, uploads, exports en configuratiesleutel. Het archief is via de download-API opgehaald; de broncontainer is verwijderd. Op een nieuwe lege installatie is een ander tijdelijk beheerdersaccount gemaakt en het archief via de upload-API aangeboden. Een verkeerde herstelcode werd afgewezen met behoud van die tijdelijke installatie. De juiste herstelcontrole en expliciete bevestiging voltooiden het herstel op **12 november 2026 om 04:49:58 UTC**.

Na opnieuw inloggen met het oorspronkelijke account zijn daadwerkelijk gecontroleerd:

- exact dezelfde SHA-256 van de oorspronkelijke instellingen-sleutel;
- succesvol ontsleutelen van het oorspronkelijke SMTP-testgeheim, vergeleken via SHA-256;
- herstelde bedrijfsinstelling;
- taak- en locatie-ID's, exacte fotohash, voorraad vijf en één unieke onderhoudsbeurt;
- geen achtergebleven actieve back-upjob die een nieuwe opdracht blokkeert;
- een nieuwe volledige back-up na het herstel;
- geslaagde samengestelde runtimehealthcheck met de back-uphelperheartbeat.

De reproduceerbare probe staat in `scripts/runtime-backup-ui.mjs`. CI voert de route uit op de daadwerkelijk gebouwde release-image, met een herstartcontrole tussen bronback-up en nieuwe installatie. In deze beperkte lokale omgeving werden gebouwde API-/Next-artifacts read-only in de echte runtime gemount. De tests zijn API-gedreven en vormen geen claim dat de browserbediening van ieder nieuw beheerscherm in deze proef is aangeklikt. Een live Microsoft/OneDrive-account is niet gebruikt.

De proef vond en corrigeerde twee integratieproblemen: de strikte proces-umask maakte de helperheartbeat onleesbaar voor de API, en een nginx-prefix met afsluitende slash veroorzaakte een ongewenste redirect op het aanmaken van een back-up. Status/resultaatbestanden krijgen nu expliciet modus 0640. De nginx-route is zonder die redirect en ondersteunt streamende back-upuploads tot de serverlimiet van 20 GiB, met een 21-GiB-proxygrens voor multipart-overhead. Algemene uploads ondersteunen de instelbare limiet tot 50 MiB met een 52-MiB-proxygrens.

Daarnaast slagen drie helpertests voor encryptie/decryptie, verkeerde herstelcode, beschadigde ciphertext, verbod op padtraversal/arbitraire opdrachten, ontbrekende herstelcontrole en duurzaam geschreven groepsleesbare statusbestanden onder de strikte runtime-umask. Journals/resultaten en archiefpublicatie worden expliciet gefsynct; de volledige runtimeproef ging vooraf aan die aanvullende durability-hardening, die in CI opnieuw over de complete route wordt getoetst. De mobiele subagent heeft de root-helper onafhankelijk beoordeeld; de bevindingen over expliciete lokale/OneDrive-bronbinding en innerlijke manifest-ID zijn verwerkt. De vier bestaande retentietests blijven groen. Alle nieuwe testcontainers, volumes en runtimeimage zijn na afloop opgeruimd.

## Eerdere CLI-herstelproef — 11 november 2026

## Opstelling en grenzen

De runtime is gebouwd uit `node:22-alpine3.22` met PostgreSQL 17.11, nginx, supervisor, age, Bash en Python. De productie API en Next standalone-output zijn read-only in de runtimecontainer gemount. Zo werden dezelfde entrypoint, supervisorconfiguratie, scripts en services getest zonder extra kopieën van node_modules. `/data` was een nieuwe Docker-volume; toegang liep alleen via containerpoort 8080 op lokale hostpoort 3080.

De volledige multi-stage source-build kon hier niet worden afgerond: de omgeving heeft 7,9 GB filesystem en Docker VFS, dat iedere laag volledig kopieert. Debian-runtime en dubbele buildlagen veroorzaakten aantoonbaar ENOSPC. De primaire runtime is daarom verkleind naar Alpine. De Alpine runtime-build en daadwerkelijke runtimeproef slaagden. De volledige source-imagebouw staat in CI en moet vóór registryrelease groen zijn. Deze proef claimt geen voltooide GHCR-publicatie.

## Resultaten

| Controle | Resultaat |
|---|---|
| Lege database initialiseren, migraties tot en met 009, eerste beheerder | Geslaagd |
| PostgreSQL/API/web/worker/back-upservice/nginx onder supervisor | Alle zes RUNNING |
| API `/api/health`, web HTTP 200, samengestelde containerhealth | Geslaagd / healthy |
| PostgreSQL superuser via localhost TCP | Correct geweigerd; approl werkt |
| Taak met stabiele locatie-ID maken | Geslaagd |
| Foto uploaden en later exacte SHA-256 vergelijken | Geslaagd |
| Voorraadontvangst 5, dezelfde operatie-ID tweemaal aanbieden | Saldo exact 5 |
| Jaarherhaling tweemaal genereren | Exact één beurt |
| Services gecontroleerd stoppen/herstarten voor consistente back-up | Geslaagd |
| `age`-versleuteld archief met DB + bestanden + checksums | Aangemaakt |
| Broncontainer verwijderen, afzonderlijke lege hersteldataset initialiseren | Geslaagd |
| Decryptie, archiefvalidatie, checksums, database- en bestandenherstel | Geslaagd |
| Na herstel taak-ID/locatielink/titel/fotohash/saldo en unieke beurt | Alle gelijk aan bron |
| Health en alle zes processen na herstel | Geslaagd |
| Bash syntaxchecks, Compose ontwikkelconfigvalidatie | Geslaagd |
| Retentie: daily/monthly selectie, dry-run, apply, onbekende bestanden/symlinks, minimum | 4 tests geslaagd |
| Onveilige tarleden `../escape` en `/etc/passwd` | Correct afgewezen |

Het restorecommando liep van **18:34:16 tot 18:34:22 UTC** (6 seconden) op een zeer kleine testdataset. De aansluitende API-verificatie slaagde. Dit is geen beloofde RTO voor een productiearchief met jaren foto's. RPO volgt de werkelijke back-upplanning, standaard dagelijks na configuratie van een encryptie-ontvanger.

De herhaalbare API-probe staat in `scripts/runtime-smoke.mjs` (`seed` en `verify`); deze is alleen bedoeld voor een geïsoleerde testinstallatie. Gebruikte testcontainers, datasets en runtimeimage zijn na afloop verwijderd om de beperkte werkomgeving vrij te maken.

## Review en reparaties

De onafhankelijke review leidde tot: hersteltrap activeren vóór gedeeltelijke servicestop, PostgreSQL hostauth beperken tot appdatabase/appgebruiker, expliciete afwijzing van archieftraversal/symlinks/speciale bestanden, flock tegen parallelle back-up/herstelacties en publieke niet-geheime statustimestamps gescheiden van private config. De runtimeproef ontdekte het ontbrekende Alpine `postgresql17-contrib`-pakket; dit is toegevoegd en alle migraties zijn daarna daadwerkelijk succesvol uitgevoerd.

## Nog externe acceptatie

Installeer de gepubliceerde release-image via de echte TrueNAS **Install Custom App**-wizard, test dataset-ACL's, eigen TLS/VPN, update/herstart en herstel op de doelhost. Test de ondertekende native releases en externe SMTP/push/AI alleen met de feitelijke accounts, credentials en apparaten. De GUI-stappen zijn gecontroleerd tegen de officiële TrueNAS-documentatie; interactie met de echte NAS is niet uitgevoerd.

## Herhaling op de 0.2-releasebron

[CI-run 43178305992](https://github.com/lvos04/tuinwerk-os/actions/runs/43178305992) heeft op broncommit `b013d96` de volledige Custom App-image gebouwd en de eerste inrichting, persistente herstart en volledige versleutelde herstelroute opnieuw succesvol uitgevoerd. Dit omvat migraties 001–019, verplichte configuratiesleutels in het archief en de nieuwe alleen-lezen `pg_restore --list`-controle vóór herstel. De 15 productie-browserflows slaagden aansluitend. Het betreft een geïsoleerde CI-container; de doel-TrueNAS en live OneDrive-aanmelding blijven apart te accepteren.
