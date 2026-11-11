# Oplevering en acceptatie — 11 november 2026

Dit project is vanuit een repository met alleen een README opgebouwd volgens het aangeleverde bouwplan. Het bevat werkende software en regressietests; het is geen verklaring dat alle productieacceptatiepoorten al zijn doorlopen.

## Installatiekeuze

De aanvullende gebruikersinstructie is verwerkt: **één standaard TrueNAS Custom App via de grafische invulvelden, zonder YAML**. De primaire image bundelt PostgreSQL 17, API, web, nginx, achtergrondtaken en versleutelde back-up. Eén dataset wordt gekoppeld aan `/data`. Zie [installatie](INSTALLATIE.md). Compose is uitsluitend een ontwikkelvoorziening.

## Gerealiseerde onderdelen

| Bouwplan | Implementatie |
|---|---|
| Accounts en rollen | Serverautorisatie, beheerdersaccount, sessies/refresh/intrekken, optionele TOTP met herstelcodes, accountbeheer |
| Taken en samenwerking | Snelle/uitgebreide melding, meerdere medewerkers, statusregels, verplichte checklist, reacties, afhankelijkheden, audit, sjablonen, foto's/documenten en annotaties |
| Planning en onderhoud | Privé/gedeelde blokken, kalender met slepen, jaarprognoses, kalender-/uitvoeringsherhaling, uitzonderingen, seizoenssjablonen en verschuiven |
| Locaties en machines | Stabiele hiërarchische IDs, cirkelcontrole, archivering, historie, onderdelenverbruik en QR-labels |
| Voorraad | Meerdere locaties, transacties, ontvangst/verbruik/transfer/correctie, minimum per artikel/locatie, tellingen en concurrentiecontrole |
| Native mobiel | Expo iOS/Android, camera/QR, annotaties, biometrie, SQLite-cache/wachtrij, accountisolatie, conflictherstel, offline media en timers |
| Rapporten en overdracht | CSV/XLSX/PDF, achtergrondexports, QR, Todoist CSV/taken en onderdelen/locatie-import met preview/mapping/deduplicatie |
| Meldingen en AI | In-app, instelbare stille uren, SMTP en Expo-pushtransporten, duurzame bezorgpogingen, weekoverzicht, optionele AI met toestemming en token-/eurobudget |
| Beheer en herstel | Healthchecks, opslag-/worker-/backupstatus, encrypted backup/restore, updateprocedure, CI en imageworkflow |

De mobiele spraakinvoer gebruikt de corrigeerbare dicteerfunctie van het systeemtoetsenbord; er wordt geen fictieve transcriptieprovider aangeboden. AI, SMTP en push zijn optioneel en vereisen eigen instellingen. De native app is geen vervangende PWA.

## Uitgevoerde verificatie

- SQL-migraties vanaf lege PostgreSQL 17-database.
- API-tests op echte PostgreSQL en HTTP: voorraadconcurrentie, idempotentie, privéplanning, sessies, rolrechten, TOTP, kalendergrenzen, seizoenen, readonly jaarprognoses, importconcurrentie, rapporten en budgetten.
- Mobiele protocoltests: queuevolgorde/retries, conflictblokkering, accountscheiding, late-refreshbescherming, paginering en lokale versieprojectie.
- TypeScript-controle van alle drie apps, API-productiebuild en Next-productiebuild.
- Android- en iOS-Metrobundels, inclusief de beveiligingspatch voor image-size. **Dit zijn geen ondertekende APK/IPA-installatietests.**
- Playwright tegen de productie-webapp: storing met verplichte checklist/afronden/heropenen; hoofdschermen en 390px-navigatie; voorraadontvangst, onvoldoende saldo en herstel met behouden invoer.
- Echte Alpine-runtime met alle processen gezond, persistente foto, voorraadretry en onderhoudsherstart. Versleuteld archief hersteld op lege dataset; foto-SHA256, taak-/locatie-ID, saldo en unieke onderhoudsbeurt gelijk. Zie [concreet herstelverslag](TEST_DEPLOYMENT.md).

De lokale complete multistage Docker-build liep tegen de 7,9 GB/VFS-omgevingslimiet aan. De bewezen runtimetest gebruikte dezelfde runtime en scripts met alleen-lezen gemounte gebouwde artifacts. De GitHub CI bouwt daarnaast de volledige image. Een remote build wordt pas als geslaagd vermeld nadat de workflow daadwerkelijk slaagt.

## Onafhankelijke controles

Zes subagents leverden implementaties; agents controleerden daarnaast elkaars werk. Gevonden en herstelde problemen betroffen onder andere onvolledige checklists op afgeronde taken, verkeerde mobiele tijdroute, sessieraces bij uitloggen, QR-context, voorraadconflictherstel, herhaling na annuleren, toekomstige gewijzigde onderhoudsregels, importdeduplicatie, datumfilters, backupstopfouten en PostgreSQL-toegang. Root voerde integratie-, build- en browsertests uit. Zie ook [API-review](reviews/API_SECURITY_REVIEW.md).

## Nog te doorlopen productiepoorten

1. De standaard Custom App-wizard op de daadwerkelijke TrueNAS-versie en hardware installeren, met eigen datasetrechten, HTTPS/VPN en restoretest op die host.
2. Eigen Apple/Google/Expo-identiteiten, definitieve signing/distributiekeuze en ondertekende releases. Installatie op echte medewerkersapparaten; camera, QR, biometrie, meldingen, achtergrondgedrag en updates testen.
3. Een echte 24-uurs offline-/netwerkuitvalproef met meerdere apparaten, foto's en gelijktijdig voorraadverbruik.
4. Eigen SMTP-, push- en optionele AI-provider met echte credentials testen; geen werkende bezorging of externe provideracceptatie veronderstellen.
5. Bedrijfsgegevens, echte Todoist-export/mapping, werkprocessen en eindgebruikersacceptatie controleren. Testgegevens zijn geen bedrijfsgegevens.
6. Herstelsleutel en TOTP-encryptiesleutel extern veilig bewaren; externe backupbestemming instellen en periodiek teruglezen.

## Bekende grenzen

- Exports zijn begrensd op 100.000 regels; generatie leest batches, maar de uiteindelijke PDF/XLSX-opbouw gebruikt geheugen. Test grotere bedrijfsdatasets voordat limieten worden verhoogd.
- Offline mobiel heeft expliciete quota (500 operaties en 250 MB wachtrijmedia). SQLite staat in de toestelsandbox; tokens gebruiken Keychain/Keystore. Toestelversleuteling blijft nodig.
- Login-rate-limiting is proceslokaal; het ontwerp is één klein-teamserver. Bij horizontaal schalen moet dit gedeeld worden.
- Uploads hebben grootte-/typecontroles en veilige downloadheaders; er is geen claim van een geïntegreerde antivirusdienst.
- De dependency-audit is uitgevoerd en hoge/kritieke bevindingen zijn gepatcht. Resterende lage/matige advisories zitten in de Expo-toolketen en moeten vóór mobiele distributie opnieuw worden beoordeeld; bundeling alleen is geen securitycertificering.
- Voorbeeldprijzen voor AI moeten overeenkomen met de eigen provider; budgetten zijn gebaseerd op expliciet ingestelde tokenprijzen.

Deze grenzen en externe acceptatiepoorten blijven zichtbaar. De software mag pas als volledig productie-geaccepteerd worden beschouwd nadat de toepasselijke controles op de doelomgeving en echte toestellen zijn afgerond.
