# Uitgevoerde installatie- en herstelproef

Datum: **11 november 2026**, managed Linux/Docker-omgeving. Uitgevoerd door deployment-subagent, met onafhankelijke broncodereview door reporting-subagent. Dit is een feitelijk verslag; het is geen claim van installatie op de gebruiker zijn TrueNAS of telefoons.

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
