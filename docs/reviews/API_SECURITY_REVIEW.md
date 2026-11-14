# Core API en onafhankelijke kruiscontroles

Datum: 11 november 2026. Uitgevoerd op lokale PostgreSQL 17; geen echte mobiele apparaten of TrueNAS-host gebruikt.

## Core implementatie en controles

- Serverauthenticatie met opaque willekeurige tokens, uitsluitend SHA-256 tokenhashes in database. Scrypt met unieke salts voor wachtwoorden. Refreshrotatie, sessie-intrekking, actieve-accountcontrole.
- Optionele beheerder-TOTP: RFC6238 SHA1, versleutelde secrets, pending setup, bevestigingscode, anti-replay tijdstap en eenmalige gehashte herstelcodes. Login en refresh vergrendelen eerst gebruiker om races met MFA-activering en deactiveren te voorkomen.
- Mutatieversies en transactiegebonden idempotentie voor offline taakwijzigingen. Taakafhankelijkheden en locatie-/assetbomen worden op cycli gecontroleerd.
- Privéplanning uitsluitend eigenaar/beheerder; gedeelde wijziging bevestigen en betrokkenen notificeren. Alleen eigenaar/beheerder wijzigt zichtbaarheid.
- Uploadbestandsheaders gecontroleerd; bestanden buiten publieke webroot en uitsluitend geauthenticeerd downloadbaar; maximale grootte. Originele bestanden blijven bij annotaties behouden.

Uitgevoerde tests staan in `apps/api/test/core.test.ts`, `core.integration.test.ts`, `http.integration.test.ts` en `totp.test.ts`. Ze omvatten status/checklist, versies, idempotentie, locatiecyclus, privéplanning, afhankelijkheidscyclus, tijdcorrectie-audit, ongeauthenticeerde toegang, medewerker/adminscheiding, uploadretry, tokenrotatie, MFA-setup, recovery-replay en RFC6238 testvectoren.

## Review door andere agents en opgeloste bevindingen

Operations-agent vond checklistwijziging die een reeds afgeronde taak kon laten eindigen met onvoltooide verplichte items, herschreven afrondingsdatum bij herhaalde completed-status en onterecht herschreven checklist-auteurs/tijdstippen. Alle drie gecorrigeerd met regressietests. Deployment-review wees op onvoldoende validatie van planningsdeelnemers en zichtbaarheid; validatie en owner-only privacy zijn toegevoegd. Reporting-review vond te kleine standaard JSON-limiet voor imports; JSON-limit is expliciet 9 MB.

## Onafhankelijke review operations door core-agent

Voorraadcode beoordeeld op transactiegrenzen, deterministische rijlocks, geen negatief saldo, atomaire transfer en telversies. Herhaling beoordeeld op kalendergrenzen en voltooiingsintervallen. Gevonden: vastlopen na annuleren/uitzonderingsdatum, ongeldige checklist kon worker stoppen, één slechte regel blokkeerde latere regels. Doorgegeven aan operations-agent voor correcties en regressies.

## Onafhankelijke review mobiele code door core-agent

Gevonden en door mobiele agent gecorrigeerd:

- Late refresh kon oude sessie terugschrijven na uitloggen/accountwissel. Scope per endpoint/gebruiker/generatie; geserialiseerde SecureStore-writes en invalidatie toegevoegd.
- Asynchrone UI-resultaten controleerden alleen gebruiker-ID. Volledige server+accountidentiteit en sessiegeneratie worden gecontroleerd.
- QR-parser verwachtte pad-ID terwijl label queryparameters bevatte. ID-queryparameter plus same-origincontrole toegevoegd.
- Gewijzigde conflictpayload behield dezelfde operatie-ID. Expliciet bevestigde correctie krijgt nieuwe ID op dezelfde wachtrijpositie; onbekend serverresultaat moet eerst opnieuw gesynchroniseerd worden.
- Nieuwe requests vanuit oude synchronisatie konden na logout doorgaan. Preflight/postresponse generatiecontrole en onmiddellijk wissen van UI-sessie toegevoegd.

## Grenzen

Dit is code- en integratietestbewijs, geen penetratietest of toestelacceptatie. Login-rate-limiting is proceslokaal en verdwijnt na herstart; productie kan aanvullend proxy-rate-limiting gebruiken. Bestandscontrole is geen antivirus/scanner en valideert headers, niet de volledige inhoud. Externe push/e-mail, iOS/Android signing en fysieke offlineproef blijven afzonderlijke acceptatiepunten. Gevoelige SQLite-cache staat binnen de OS-appsandbox en is niet apart met SQLCipher versleuteld.
