# Verbeteringen in TuinWerk OS 0.2

Deze ronde werkt de zeven afgesproken verbeterpunten uit. Installeren blijft één standaard TrueNAS Custom App met image, poort en `/data`; geen YAML-installatie.

| Onderdeel | Wat is toegevoegd |
|---|---|
| Mobiel starten | Mijn werk vandaag, storing melden, QR scannen en favorieten voor machines, locaties en sjablonen |
| Taken uitvoeren | Een werkpaneel voor checklist, foto's, tijd en onderdelen; invoer blijft behouden bij fouten |
| Offline werken | Status per wijziging, pogingen en serverbevestiging; een conflict houdt afhankelijke wijzigingen tegen, zelfstandig werk kan verder |
| Beheer | Afzonderlijke onderdelen voor medewerkers, instellingen, integraties en back-ups; een ingebruiknamechecklist en expliciete verbindingstests |
| Planning | Beschikbaarheid per weekdag, geplande minuten zonder dubbeltelling, zichtbare overbelasting en achterstallig onderhoud |
| Meldingen | Instelbare bundeling met stille uren en veilige verwijzingen naar de juiste taak, server en gebruiker |
| Back-ups | Afzonderlijke lokale/cloudstatus, achterstand en opslagmeldingen, herinneringen en geregistreerde herstelcontroles |

## Wat de controles betekenen

Een lokale back-up is niet automatisch een geslaagde OneDrive-kopie. De UI toont beide afzonderlijk. Een geslaagde archiefcontrole bewijst ontsleuteling en inhoudsvalidatie; zij bewijst niet dat een productie-installatie hersteld is. De begeleide controle vraagt daarom afzonderlijke waarnemingen uit een herstelde testinstallatie. Eerdere cloudarchieven blijven onder het eigen bewaarbeleid vallen.

Capaciteit is gebaseerd op zichtbare tijdsblokken en ingestelde beschikbaarheid. Overlappende blokken tellen eenmaal. Een medewerker ziet voor collega's alleen gedeeld werk; de UI noemt die beperking. De bestaande eigenaar-/beheerdersrechten voor privéplanning blijven gelden.

Een verbindingstest wordt pas na een bewuste klik uitgevoerd. Testmail gaat naar de aangemelde beheerder, testpush naar diens eigen geregistreerde apparaten. Een provider die een bericht accepteert bewijst nog niet dat iemand het ontvangen heeft. De OneDrive-proef controleert de eigen appmap met een tijdelijk testbestand.

## Voorbereiding op App Store en Google Play

De gekozen route is directe voorbereiding op de stores: Android App Bundle en iOS App Store-build, met interne Play-testdistributie en TestFlight vóór openbare indiening. Configuratiecontrole blokkeert ontbrekende accounts, echte publieke URL's en uitgeversgegevens; er worden geen fictieve accounts of privacycontacten ingevuld.

De Apple-controle heeft concrete aanvullende functies opgeleverd: zelfstandige accountverwijdering met herauthenticatie, publieke privacy-/support-/verwijderpagina's, expliciete toestemming voor de actuele AI-provider en meld-/filter-/moderatievoorzieningen voor de besloten werkruimte. Accountverwijdering verwijdert de accountgegevens en toegang daadwerkelijk. Gedeelde bedrijfsregistraties worden ontkoppeld van het account; vrije teksten en oude back-ups vereisen het beschreven aanvullende bewaarbeleid.

Een uitgever moet vóór indiening de eigen contactgegevens en bewaartermijnen in de UI invullen en publiek bereikbaar maken. Apple krijgt een bereikbare HTTPS-testserver, fictieve gegevens en afzonderlijke reviewaccounts; geen productiegegevens. Storeformulieren, screenshots, leeftijdsclassificatie, privacyverklaringen en eventuele EU-uitgeversgegevens moeten overeenkomen met de daadwerkelijke distributie.

## Praktijkacceptatie

Automatische HTTP-/PostgreSQL-tests gebruiken de echte mobiele wachtrij en controleren verloren serverbevestigingen, herladen van opgeslagen opdrachten en gelijktijdige voorraadboekingen. Dit is geen bewijs van 24 uur werken op een fysiek toestel. Daarvoor blijven de toestelproeven, achtergrond-/herstartgedrag, camera, biometrie, pushbezorging en de lange offlineproef nodig. Storeondertekening en indiening vereisen de eigen Apple-, Google- en Expo-toegang.

De broncode en tests zijn geen garantie van App Review-goedkeuring. Zie de store- en toestelhandleidingen voor de gecontroleerde vereisten en de resterende uitgeverstappen.

Uitwerking: [Apple-controle](mobile/APPLE_REVIEW_CHECK.md), [store-uitrol](mobile/STORE_RELEASE.md), [gegevensstromen](mobile/DATA_PRIVACY.md) en [toestelacceptatie](mobile/MOBILE_DEVICE_ACCEPTANCE.md).
