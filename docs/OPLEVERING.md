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
- 30 API-tests op echte PostgreSQL en HTTP: voorraadconcurrentie, idempotentie, privéplanning, sessies, rolrechten, TOTP, kalendergrenzen, seizoenen, readonly jaarprognoses, importconcurrentie, rapporten en budgetten.
- 8 mobiele protocoltests: queuevolgorde/retries, conflictblokkering, accountscheiding, late-refreshbescherming, paginering en lokale versieprojectie.
- TypeScript-controle van alle drie apps, API-productiebuild en Next-productiebuild.
- Android- en iOS-Metrobundels, inclusief de beveiligingspatch voor image-size. **Dit zijn geen ondertekende APK/IPA-installatietests.**
- 4 Playwright-tests tegen de productie-webapp: storing met verplichte checklist/afronden/heropenen; hoofdschermen en 390px-navigatie; voorraadontvangst, onvoldoende saldo en herstel met behouden invoer; sjabloon toepassen en jaarprognose.
- 4 back-upretentietests (bewaarselectie en bescherming van onbekende bestanden).
- Echte Alpine-runtime met alle processen gezond, persistente foto, voorraadretry en onderhoudsherstart. Versleuteld archief hersteld op lege dataset; foto-SHA256, taak-/locatie-ID, saldo en unieke onderhoudsbeurt gelijk. Zie [concreet herstelverslag](TEST_DEPLOYMENT.md).

De lokale complete multistage Docker-build liep tegen de 7,9 GB/VFS-omgevingslimiet aan. De bewezen runtimetest gebruikte dezelfde runtime en scripts met alleen-lezen gemounte gebouwde artifacts. De volledige multistage imagebuild is daarna wel geslaagd op de schone GitHub-runner: [buildcontrole](https://github.com/lvos04/tuinwerk-os/actions/runs/43079913792). De CI controleert aanvullend opstarten/herstarten van de gebouwde image.

## Onafhankelijke controles

Zes subagents leverden implementaties; agents controleerden daarnaast elkaars werk. Gevonden en herstelde problemen betroffen onder andere onvolledige checklists op afgeronde taken, verkeerde mobiele tijdroute, sessieraces bij uitloggen, QR-context, voorraadconflictherstel, herhaling na annuleren, toekomstige gewijzigde onderhoudsregels, importdeduplicatie, datumfilters, backupstopfouten en PostgreSQL-toegang. Root voerde integratie-, build- en browsertests uit. Zie ook [API-review](reviews/API_SECURITY_REVIEW.md).

## Nog te doorlopen productiepoorten

1. De standaard Custom App-wizard op de daadwerkelijke TrueNAS-versie en hardware installeren, met eigen datasetrechten, HTTPS/VPN en restoretest op die host.
2. Eigen Apple/Google/Expo-identiteiten, definitieve signing/distributiekeuze en ondertekende releases. Installatie op echte medewerkersapparaten; camera, QR, biometrie, meldingen, achtergrondgedrag en updates testen.
3. Een echte 24-uurs offline-/netwerkuitvalproef met meerdere apparaten, foto's en gelijktijdig voorraadverbruik.
4. Eigen SMTP-, push- en optionele AI-provider met echte credentials testen; geen werkende bezorging of externe provideracceptatie veronderstellen.
5. Bedrijfsgegevens, echte Todoist-export/mapping, werkprocessen en eindgebruikersacceptatie controleren. Testgegevens zijn geen bedrijfsgegevens.
6. De back-upherstelcode extern veilig bewaren; de volledige archieven bevatten de TOTP- en instellingensleutels. OneDrive met het eigen Microsoft-account aanmelden en periodiek teruglezen.

## Bekende grenzen

- Exports zijn begrensd op 100.000 regels; generatie leest batches, maar de uiteindelijke PDF/XLSX-opbouw gebruikt geheugen. Test grotere bedrijfsdatasets voordat limieten worden verhoogd.
- Offline mobiel heeft expliciete quota (500 operaties en 250 MB wachtrijmedia). SQLite staat in de toestelsandbox; tokens gebruiken Keychain/Keystore. Toestelversleuteling blijft nodig.
- Login-rate-limiting is proceslokaal; het ontwerp is één klein-teamserver. Bij horizontaal schalen moet dit gedeeld worden.
- Uploads hebben grootte-/typecontroles en veilige downloadheaders; er is geen claim van een geïntegreerde antivirusdienst.
- De dependency-audit is uitgevoerd en hoge/kritieke bevindingen zijn gepatcht. Resterende lage/matige advisories zitten in de Expo-toolketen en moeten vóór mobiele distributie opnieuw worden beoordeeld; bundeling alleen is geen securitycertificering.
- Voorbeeldprijzen voor AI moeten overeenkomen met de eigen provider; budgetten zijn gebaseerd op expliciet ingestelde tokenprijzen.

Deze grenzen en externe acceptatiepoorten blijven zichtbaar. De software mag pas als volledig productie-geaccepteerd worden beschouwd nadat de toepasselijke controles op de doelomgeving en echte toestellen zijn afgerond.

## Repository en controles

De implementatie staat op branch `feat/complete-tuinwerk-os`, aangeboden als [concept-PR #1](https://github.com/lvos04/tuinwerk-os/pull/1). De workflow **Verify TuinWerk OS** voert tests, builds en browseracceptatie opnieuw uit op een schone GitHub-runner. De workflow **Build Custom App image** levert versievaste image-tags voor de TrueNAS-invultabel; alleen daadwerkelijk geslaagde gepubliceerde tags mogen als beschikbare image worden vermeld.

## Geverifieerde releasecandidate

`v0.1.0-rc.1` / container-tag `0.1.0-rc.1` is gepubliceerd. [De imageworkflow](https://github.com/lvos04/tuinwerk-os/actions/runs/43080459746) en [volledige CI met containerherstart en vier browserflows](https://github.com/lvos04/tuinwerk-os/actions/runs/43080466192) zijn geslaagd. Anonieme manifestopvraag gaf HTTP 200 met digest `sha256:b0637c742e26da055de6625b2861620f3f12f929aa6db0aeefc80169500f8098`. Hiermee zijn de bron-imagebuild en publicatie bewezen; de fysieke productiepoorten hierboven blijven staan.

## Uitbreiding: UI-inrichting en OneDrive — 12 november 2026

De Custom App vereist nu uitsluitend image, webpoort en persistente datamap. De welkomstwizard gebruikt een eenmalige eigenaarscode uit de TrueNAS-logs. Bedrijf, appadres, tijdzone, SMTP, AI, push, uploadlimiet, onderhoud en back-upplanning worden in web en native app ingesteld. Geheime instellingen zijn versleuteld, worden niet teruggestuurd en kunnen expliciet worden gewist. Gelijktijdige wijzigingen gebruiken versiecontrole.

OneDrive gebruikt Microsoft device-code-aanmelding en uitsluitend de eigen appmap. Tokens en hervatbare uploadsessies worden versleuteld opgeslagen. Volledige `.twb`-archieven bevatten PostgreSQL, uploads, exports en configuratiesleutels; AES-256-GCM met scrypt beschermt de inhoud. De UI vraagt de herstelcode extern te bewaren voordat planning wordt ingesteld. Herstel vereist een succesvolle inhoudscontrole en expliciete bevestiging; de beperkte roothelper verzorgt consistente snapshots en terugval bij fouten.

De Microsoft-protocoltests gebruiken een gesimuleerde Graph-dienst en een echte geïsoleerde PostgreSQL-database. Zij bewijzen geen live Microsoft-accounttoestemming; die controle blijft nodig met het eigen account. Lokale bewaartermijnen verwijderen geen cloudarchieven.

Aanvullende lokale verificatie op 12 november: 35 API-tests, 11 mobiele tests, 3 archiefcryptografie-/opdrachtvalidatietests en 4 retentietests geslaagd; typechecks en productiebuilds groen. Acht browserscenario’s op echte PostgreSQL/HTTP zijn geslaagd (vier bestaande werkprocessen en vier nieuwe inrichting-/instellingenflows), inclusief desktop- en 390px-controle. Android/iOS-Metrobundels zijn opnieuw gegenereerd. De nieuwe herstelproef verifieert ook dat de originele configuratiesleutel terugkomt, het opgeslagen SMTP-geheim weer ontsleutelt en na herstel een volgende back-up mogelijk is.

Releasecandidate `v0.1.0-rc.2` bevat deze uitbreiding. De [volledige CI](https://github.com/lvos04/tuinwerk-os/actions/runs/43157894658) slaagde op broncommit `916b7e5`, inclusief de echte gebouwde container, eerste inrichting zonder `ADMIN_*`, herstart en volledig herstel. De image is anoniem bereikbaar (HTTP 200) als `ghcr.io/lvos04/tuinwerk-os:0.1.0-rc.2`, digest `sha256:9143c08a32802e64ac6296a77656a4425dbc51803e3b3531c2f795cc1bc47e25`. [Imagepublicatie](https://github.com/lvos04/tuinwerk-os/actions/runs/43157998296).
