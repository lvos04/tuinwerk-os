# API-contract

Basis `/api`. Alle routes behalve `/health`, `/auth/login`, `/auth/refresh` vereisen `Authorization: Bearer <token>`. OpenAPI-routecatalogus staat op `/api/docs`. Lijsten zijn JSON-arrays. Velden camelCase, UUID-identificaties, ISO timestamps, datums van herhalingen YYYY-MM-DD. 400 = invoer, 401 = sessie, 403 = rechten, 404 = afwezig, 409 = conflict. Geen automatische retry met gewijzigde gegevens op een conflict.

Login: `POST /auth/login {email,password,device?}` retourneert `{token,refreshToken,user}`. Token geldt 1 uur. `POST /auth/refresh {refreshToken}` roteert beide tokens. Bewaar native tokens in SecureStore. `GET /auth/me`, `/auth/sessions`; `DELETE /auth/sessions/:id`, `POST /auth/logout`. Admin `POST /users {email,name,password,role}` en `POST /users/:id/deactivate`. GET /users voor teamlijst.

Taken: `GET /tasks?status=&priority=&assignedTo=&assetId=&locationId=&q=&limit=100&offset=0`. Maximum pagina 500. `POST /tasks` vereist titel; overige velden: description, category, tags, priority (low/normal/high/critical), locationId, assetId, assignedTo (UUID-array), dependencies (UUID-array), checklist, availableFrom, plannedAt, deadline, estimatedMinutes. Client mag id UUID meesturen. `PATCH /tasks/:id` vereist actuele version, overige gewijzigde velden. `status` open/planned/in_progress/blocked/completed/cancelled/archived; reason verplicht bij blokkeren en heropenen. Checklist: `[{id,text,required,done}]`. Afronden kan alleen met voltooide verplichte items. Afgeronde taak moet expliciet naar open worden heropend. Archief is alleen-lezen.

POST taken/PATCH taken/reacties/tijd/uploads/locaties/machines/planning/templates ondersteunen optioneel `operationId`: dezelfde gebruiker+operatie-ID+identieke payload levert identieke response. Een andere payload op dezelfde operatie-ID geeft 409. Bewaar operatie-ID en payload duurzaam op het toestel tot de server bevestigt. Identiteit van een nieuwe offline taak: maak client UUID vooraf. Na conflict huidige serverversie tonen; een bewuste herziening krijgt nieuwe operatie-ID. Afhankelijkheden mogen geen cyclus vormen.

`GET /tasks/:id/history`, `GET/POST /tasks/:id/comments {body}`, `GET/POST /tasks/:id/time {startedAt?,endedAt?,minutes?,note?}`. Zonder eindtijd of minutes start een timer; slechts één timer per gebruiker. `POST /time/:id/stop` stopt eigen timer. `PATCH /time/:id {version,minutes,reason,note?}` corrigeert een afgesloten eigen registratie (beheerder mag ook andere corrigeren); eerdere en nieuwe waarden blijven in audit.

Bijlagen: `POST /attachments` multipart `file`, `taskId` of `assetId`, `phase` before/during/after, `operationId`. JPEG/PNG/WebP/PDF magic-bytevalidatie; standaard maximaal 10 MiB. GET /attachments?taskId= of assetId=; beveiligde download GET /attachments/:id/file. `POST /attachments/:id/annotation {version,annotation,operationId}` bewaart annotatiemetadata zonder origineel te wijzigen. Gearchiveerde taken weigeren nieuwe uploads met 409. Alleen bestandsheaders worden gevalideerd; er is geen geïnstalleerde antivirusscanner.

GET/POST /locations: name, parentId, type, metadata. PATCH /locations/:id vereist version, active=false archiveert. GET/POST /assets: name, locationId, parentId, manufacturer, model, serialNumber, notes, installationDate, warrantyDate. PATCH versie vereist. GET /assets/:id/history geeft taken en verplaatsings-/wijzigingsaudit.

GET /schedules?from=&to= filtert privéblokken server-side op eigenaar/beheerder. POST {title,taskId?,startsAt,endsAt,shared,participants}. PATCH /schedules/:id vereist version, confirmShared=true bij wijziging van andermans gedeeld blok. Alleen eigenaar/beheerder wijzigt zichtbaarheid. Planning verandert geen taakdeadline; betrokkenen krijgen meldingen.

GET /search?q= doorzoekt taken/reacties/assets/locaties/artikelen. GET/POST /templates {name,template:{title,...taakvelden}}; PATCH /templates/:id {version,...}; POST /templates/:id/apply {operationId,overrides?}. GET /profile/preferences en PATCH {version,preferences} bewaren gebruikersspecifieke filters/dashboardkeuzes.

DELETE /admin/data/:type/:id vereist admin, {confirm:id,reason}. type task/asset/location/item. Alleen reeds gearchiveerde records zonder historische FK-verwijzingen worden verwijderd. Verwijdering krijgt audit met oorspronkelijke record; er vindt geen cascade van historie plaats.

Voorraad: `/inventory/items`, `/inventory/balances`, `/inventory/movements`, `/inventory/counts`. Iedere boeking vereist UUID operationId. Herhaling `/recurrences`, `/recurrences/generate`, seizoenen `/seasons` en `/seasons/:id/activate`. Zie broncontrollers en OpenAPI-routecatalogus voor gespecialiseerde velden.

Rapportages `/reports/summary`, `/reports/export?format=csv|xlsx|pdf`; QR PDF `/qr/:type/:id`; import `/imports/preview`, `/imports/:id/confirm`; notificaties `/notifications`, `/notifications/preferences`; AI `/ai/status`, `/ai/suggest`; admin status `/admin/status`, export `/admin/export`. Externe AI blijft uit zonder expliciete configuratie en toestemming per verzoek.

## Optionele tweede factor voor beheerders

De Custom App maakt zelf een sleutel in `/data/config/totp.key`; volledige versleutelde back-ups nemen deze mee. Bewaar de back-upherstelcode buiten de NAS. `TOTP_ENCRYPTION_KEY` blijft uitsluitend als bestaande beheer-/ontwikkeloverride ondersteund. GET /auth/mfa geeft enabled/available. POST /auth/mfa/setup {password} geeft tijdelijk secret en otpauth URI; MFA is dan nog niet actief. POST /auth/mfa/enable {otp} bevestigt de eerste code en retourneert tien herstelcodes, alleen bij deze actie zichtbaar. Andere sessies worden ingetrokken. Bewaar de herstelcodes buiten het toestel. Bij volgende login wordt `otp` toegevoegd (TOTP-code of eenmalige herstelcode). De server weigert reeds gebruikte tijdstappen en hergebruikte herstelcodes. POST /auth/mfa/disable {password,otp} schakelt MFA uit met auditregistratie. MFA is optioneel en vereist beheerderrol; accounts zonder ingeschakelde MFA houden hun bestaande loginflow.


Nieuwe API-contracten: [productiviteit](PRODUCTIVITEIT_API.md), [accountverwijdering](ACCOUNTVERWIJDERING.md), [UI-instellingen](INSTELLINGEN_API.md). Openbare contact- en privacyvelden staan zonder authenticatie op `GET /api/public/info`; dit endpoint bevat uitsluitend de expliciet toegestane publieke velden.
