# Rapportage, import en meldingen

Alle endpoints staan onder `/api` en vereisen een geldige Bearer-sessie. Rapportages bevatten algemeen zichtbare taken, machines en voorraad; persoonlijke agenda's worden niet in gewone rapportages opgenomen. Alleen de complete beheerdersdata-export bevat privéplanning.

## Rapportage en uitvoer

`GET /reports/summary` accepteert `from`, `to`, `assetId`, `locationId` en `assigneeId`. Een datum zonder tijd bij `to` omvat de hele UTC-kalenderdag. Datums filteren op aanmaak van de taak. De uitkomst bevat aantallen, achterstanden, gemiddelden met steekproefgrootte, geregistreerde minuten, blokkeeruren uit statusgeschiedenis, verbruik per machine en werkdruk per week. Kleine aantallen zijn geen betrouwbare trend.

`GET /reports/export?type=tasks|inventory|assets&format=csv|xlsx|pdf` levert direct een bestand. Taakrapporten hebben maximaal 10.000 regels. Voorraadexport is een actueel saldo (locatiefilter); machine-export ondersteunt machine- en locatiefilter. CSV beschermt tegen formule-injectie, Excel schrijft waarden en PDF is een zelfstandig afdrukbaar bestand. Exportdatum en filters zijn opgenomen.

Voor grotere uitvoer: `POST /reports/jobs` met dezelfde filters als JSON. `GET /reports/jobs` toont eigen opdrachten (queued/completed/failed). `GET /reports/jobs/:id/download` levert het voltooide bestand uitsluitend aan de aanvrager. De worker haalt taakgegevens in batches van 1.000 op, met een maximum van 100.000 regels per export; bij meer regels faalt de opdracht met een verzoek de periode te beperken. Bestanden staan in `EXPORT_DIR`; deze map wordt meegeback-upt. Generatie houdt het eindrapport in geheugen, dus begrens de periode bij grote PDF's. Afgebroken jobs blijven queued en worden opnieuw uitgevoerd.

`GET /qr/:type/:id` (`task`, `asset`, `location`, `item`) levert een QR-label-PDF. De QR bevat een stabiele UUID-URL, zonder token of geheime gegevens. De geopende applicatie blijft authenticatie vereisen.

## Import met controle vooraf

Beheerders gebruiken `POST /imports/preview` voor Todoist/taken of `POST /imports/catalog/preview` voor onderdelen/locaties. Body: `filename`, `content` (base64), optioneel `mapping`; catalogus vereist `kind: inventory|locations`. Maximaal 6 MB gecomprimeerde invoer, 5.000 rijen en 50 MB uitgepakte XLSX-inhoud. CSV accepteert komma of puntkomma, BOM, quotes en regeleinden in cellen. XLSX-formules worden niet uitgevoerd.

De preview toont alle rijen, fouten en duplicaten. Daarna bevestigen via `/imports/:id/confirm` of `/imports/catalog/:id/confirm`. Bevestiging is transactioneel en herhaalbaar zonder dubbele verwerking. Originele bestanden, gecontroleerde rijen, herkomst en eindrapport blijven in PostgreSQL bewaard. Ongeldige rijen worden overgeslagen en geteld; de preview wijzigt geen taken of voorraad.

Takenkolommen: title/titel/content/name, description/omschrijving, priority/prioriteit, deadline/due_date/date, id/task_id/external_id. Todoist `TYPE`-regels anders dan task worden overgeslagen. Numerieke prioriteit 1–4 wordt laag–kritiek. Project kan via gekozen categorie/locatie worden vertaald. Herimport gebruikt externe taak-ID, of een hash van titel/omschrijving/deadline zonder ID.

Onderdelen: name/naam, sku/artikelnummer, unit/eenheid, minimum/minimumvoorraad, description/omschrijving. Bestaande artikelnummers worden overgeslagen. Import wijzigt nooit voorraadsaldi; ontvangst/correctie loopt via het mutatiejournaal. Locaties: path/pad/locatiepad zoals `Kas 1 / Kap 2`, plus type. Bestaande paden worden hergebruikt; een gedeactiveerde locatie in het pad blokkeert bevestiging totdat die expliciet geactiveerd wordt of een ander pad gekozen is.

## Meldingen en externe transports

Taak-, reactie- en gedeelde planningsmutaties schrijven in-appgebeurtenissen. De worker maakt een duurzaam uniek weekoverzicht en dagelijkse deadline-/plannings-/lagevoorraadherinneringen. Voorkeuren (`GET/PUT /notifications/preferences`) regelen in-app, push, e-mail, stille uren en kritieke uitzonderingen. Stille uren gebruiken `APP_TIMEZONE` (standaard Europe/Amsterdam).

Pushapparaten: `POST /notifications/devices` met Expo-token en `platform: ios|android`; eigen lijst en intrekking via GET/DELETE. `EXPO_PUSH_ENABLED=true` activeert Expo's transport, optioneel met `EXPO_ACCESS_TOKEN`. Native signing en APNs/FCM-projectconfiguratie blijven nodig. Ticketreceipts worden na 15 minuten gecontroleerd; DeviceNotRegistered deactiveert het token. Een providerreceipt bevestigt overdracht aan pushinfrastructuur, niet dat een medewerker de melding heeft gezien.

E-mail: configureer `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, eventueel `SMTP_USER`/`SMTP_PASSWORD`; TLS is standaard vereist. `SMTP_SECURE=true` voor impliciet TLS, doorgaans poort 465. De transports verzenden alleen na expliciete configuratie en persoonlijke voorkeur. De DB-outbox bewaart retries, fouten en verzendstatus. Er zijn maximaal acht pogingen met backoff; een crash na provideracceptatie kan een dubbele melding veroorzaken (at-least-once). Transporttests gebruiken mocks; echte bezorging moet met eigen credentials en apparaten geaccepteerd worden.

## Optionele AI

Standaard uitgeschakeld. Activering vereist `AI_ENABLED=true`, `AI_BASE_URL` (HTTPS, OpenAI-compatible `/v1`), `AI_MODEL`, `AI_API_KEY`, `AI_DAILY_TOKEN_BUDGET`, `AI_DAILY_BUDGET_EUR`, `AI_INPUT_EUR_PER_MILLION` en `AI_OUTPUT_EUR_PER_MILLION`. De beheerder moet actuele providerprijzen invullen. De server reserveert atomisch en conservatief 4.500 input- en 500 outputtokens per aanvraag; mislukte aanvragen verbruiken de reservering ook om retries niet onbeperkt te maken. Dit begrenst het berekende budget op basis van ingestelde prijzen; de factuur van de provider blijft leidend.

`POST /ai/suggest` verzendt alleen de ingevoerde tekst (maximaal 4.000 tekens) nadat `consent:true` bevestigd is. De audit bevat provider/tekstlengte, niet de inhoud. Het resultaat is uitsluitend een voorstel: `applied:false`, `requiresApproval:true`. Geen automatische taak-, voorraad- of planningsmutatie. Buiten deze expliciete actie deelt de AI-module geen data.

## Integratietests en onboarding

Beheer → Integraties toont welke inrichting aanwezig is en welke controles daadwerkelijk zijn uitgevoerd. E-mail, push en AI zijn optioneel; een uitgeschakelde module blokkeert de kern niet. Een geslaagde archiefvoorvertoning geldt niet als een volledige herstelproef. Het overzicht vermeldt dat onderscheid.

Een test start uitsluitend na de expliciete testactie met bevestiging. SMTP stuurt naar het eigen ingelogde beheerdersadres. Push stuurt uitsluitend naar de gekozen eigen actieve apparaten. OneDrive schrijft een uniek klein testbestand in de eigen appmap, leest het terug en verwijdert precies dat bestand. Resultaten bevatten geen wachtwoorden, tokens of ruwe providerfouten. SMTP- of pushacceptatie bewijst nog niet dat de gebruiker het bericht daadwerkelijk ontvangen of gelezen heeft. Na gewijzigde instellingen vervalt de geldigheid van een eerder testresultaat.

API: `GET /admin/integrations/status`; `POST /admin/integrations/test/smtp|push|onedrive` met `{confirm:true}` en voor push optioneel een eigen `deviceId`. Een ontbrekende configuratie of apparaatkeuze geeft een duidelijke fout zonder verzending.

## Bundeling en veilige meldingslinks

De persoonlijke voorkeur `digestMinutes` bundelt normale meldingen gedurende 0–60 minuten; standaard 5 minuten, 0 betekent direct. Kritieke meldingen met ingeschakelde uitzondering krijgen voorrang. Stille uren blijven gelden voor andere meldingen. De in-appgebeurtenissen blijven afzonderlijk bewaard.

De server bewaart de bundelleden en per pushapparaat welke provideracceptaties al geslaagd zijn. Bij een gedeeltelijke fout wordt alleen het nog mislukte apparaat opnieuw geprobeerd. Een procescrash precies na acceptatie door een externe provider kan nog steeds een herhaling veroorzaken: externe bezorging is niet transactioneel met PostgreSQL. Quarantaine of moderatie verwijdert verborgen inhoud uit nog te verzenden bundels zonder de overige zichtbare gebeurtenissen te verliezen.

Pushdata koppelt de melding aan ontvanger, serverorigin en objecttype. Alleen een echte taakmelding voor het ingelogde account en de actuele server kan rechtstreeks een taak openen. Een bundel met verschillende taken opent geen willekeurige taak. Apparaten die inmiddels aan een ander account zijn gekoppeld ontvangen geen oude accountgebonden meldingen.

## Toestemming voor een actuele AI-provider

Vóór verzending toont de client de providerorigin, het model, het doel en de exacte ingevoerde tekst. `/ai/status` levert daarvoor uitsluitend veilige openbare metadata en een `providerConfigId`. `/ai/suggest` vereist naast `consent:true` dezelfde `providerConfigId`. Bij een gewijzigde provider of model wordt niets verzonden: de gebruiker moet eerst de nieuwe ontvanger bekijken en opnieuw toestemming geven. De server houdt sleutel, endpoint en model van één goedgekeurde configuratie bij elkaar tijdens de aanvraag.
