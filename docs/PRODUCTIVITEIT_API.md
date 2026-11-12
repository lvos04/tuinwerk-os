# Favorieten en planningscapaciteit

Alle routes vereisen een aangemelde medewerker. Favorieten horen bij de huidige gebruiker; de API accepteert geen andere eigenaar vanuit de client.

- `GET /api/profile/favorites`: array `{type,id,name,available}`. Type is `asset`, `location` of `template`.
- `PUT /api/profile/favorites {type,id}`: idempotent toevoegen. Het doel moet bestaan en actief zijn.
- `DELETE /api/profile/favorites/:type/:id`: alleen de eigen favoriet verwijderen, ook als het doel inmiddels is gearchiveerd.

Identificaties blijven stabiel bij hernoemen of verplaatsen. Een gearchiveerd/verwijderd doel blijft als niet-beschikbare favoriet zichtbaar totdat de medewerker deze verwijdert. Favorieten verlenen geen aanvullende toegangsrechten.

## Beschikbaarheid

`GET /api/profile/capacity` geeft `{userId,weekdayMinutes,version}`. `weekdayMinutes` bevat zeven gehele minutenwaarden van zondag tot en met zaterdag. Standaard: `[0,480,480,480,480,480,0]`. Versie 0 betekent dat nog geen persoonlijke instelling bestaat.

`PATCH /api/profile/capacity {version,weekdayMinutes}` wijzigt de eigen beschikbaarheid. Elke waarde is 0–1440; 0 betekent niet beschikbaar. Versieconflicten geven 409. Beheerders kunnen dezelfde GET/PATCH uitvoeren op `/api/users/:id/capacity`. Wijzigingen worden geaudit.

## Capaciteitsweergave

`GET /api/planning/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=...` ondersteunt maximaal 93 kalenderdagen, inclusief begin- en einddag. De response bevat `timezone`, `definition`, `days` en `overdueMaintenance`.

Per medewerker/dag worden zichtbare tijdsblokken op daggrenzen in de ingestelde bedrijfstijdzone afgeknipt en samengevoegd. Overlap telt één keer; gedeelde deelnemers krijgen het blok ook in hun eigen bezetting. Taakschattingen zonder tijdsblok worden niet opgeteld. `overloadedMinutes = max(0, plannedMinutes - capacityMinutes)`.

Privéblokken blijven alleen voor eigenaar en beheerder zichtbaar, conform het bestaande planningsmodel. Een medewerker die een collega bekijkt krijgt altijd `scope: shared-only` en `privateMinutesHidden: true`, ongeacht of die collega daadwerkelijk privéblokken heeft. De UI moet dit als **gedeelde planning** tonen; dit is geen uitspraak over de volledige werkdruk van die collega. Eigenaar/beheerder krijgt `scope: all-visible`. Er worden geen bloktitels of privégegevens in het aggregaat teruggestuurd.

`overdueMaintenance` telt niet-afgeronde, niet-geannuleerde en niet-gearchiveerde taken waarvan de deadline binnen het geselecteerde venster en vóór het huidige moment ligt. Onderhoud betekent categorie `onderhoud` of een koppeling aan een concrete herhaalbeurt. Bij `userId` worden alleen diens toegewezen taken geteld. Oudere achterstanden buiten het gekozen venster zijn dus niet in deze teller opgenomen.

Tests in `apps/api/test/productivity.test.ts` controleren overlap, daggrenzen, favorieteneigenaarschap, archivering, versieconflicten, gedeelde deelnemers, medewerker-/beheerderprivacy en het deadlinevenster.
