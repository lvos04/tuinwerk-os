# Volledige back-up en herstel via de webinterface

Beheerders voeren back-ups en herstel uit onder **Beheer → Instellingen → Back-ups**. Het herstelarchief bevat de database, foto's/bijlagen, exports en de configuratiemap met de beschermde instellingen-sleutel. Daardoor bevat het ook accounts, rechten, onderhoud, voorraad, instellingen en opgeslagen integratieconfiguratie. Lopende tijdelijke opdrachten en herstelcodes in de werkqueue worden niet in het archief opgenomen.

## Een back-up instellen

1. Maak in het back-upscherm een herstelcode en download/bewaar die buiten de NAS, bijvoorbeeld in een wachtwoordkluis. Bevestig in de UI dat de code veilig is opgeslagen.
2. Kies de automatische planning en lokale bewaartermijn. Bewaar oudere herstelcodes zolang er archieven bestaan die daarmee zijn versleuteld.
3. Klik **Back-up maken**. De UI toont de opdrachtstatus en het resultaat. De toepassing pauzeert schrijvende diensten kort om database en bestanden consistent vast te leggen; tijdens dit moment kan de verbinding tijdelijk wegvallen.
4. Download desgewenst het volledige `.twb`-bestand. Behoud de UUID-bestandsnaam: die identificeert hetzelfde archief lokaal, in OneDrive en bij upload voor herstel.
5. Verbind OneDrive via de eigen beheerpagina en schakel de gewenste externe kopie in. Controleer de afzonderlijke cloudstatus; een lokale back-up betekent nog niet dat de externe upload gelukt is.

Archieven gebruiken streaming AES-256-GCM met een per-archief willekeurig salt en nonce; de herstelcode levert via scrypt de sleutel. De authenticatietag wordt volledig gecontroleerd vóór enige herstelmutatie. Een onjuiste code of beschadigd bestand wordt afgewezen. Zonder de externe herstelcode zijn de archieven niet herstelbaar, ook niet als de NAS verloren is gegaan.

## Herstellen op een nieuwe NAS of nieuwe installatie

1. Installeer dezelfde of een ondersteunde nieuwere release als één Custom App met een **nieuwe lege dataset**. Maak via het welkomstscherm een tijdelijk beheerdersaccount aan.
2. Open **Back-ups**. Upload het oorspronkelijke `.twb`-bestand, of verbind OneDrive en selecteer het gewenste externe archief. Voor een nieuwe installatie kan de cloudkoppeling opnieuw via Microsoft worden geautoriseerd.
3. Voer de apart bewaarde herstelcode in en kies **Herstel controleren**. De helper ontsleutelt, valideert manifest en checksums, controleert veilige bestandspaden en bindt de controle aan het exacte archief en de gekozen bron.
4. Beoordeel datum, versie en inhoud. Bevestig expliciet met de getoonde `HERSTEL <back-up-ID>`-tekst. De controle is maximaal een uur geldig; gewijzigde bytes of een andere bron vereisen een nieuwe controle.
5. De app bewaart eerst een tijdelijke terugvalkopie, herstelt database, bestanden en configuratiesleutel samen, voert migraties uit en herstart de diensten. Bij een herstelprobleem probeert de helper automatisch de oorspronkelijke installatie terug te zetten. Een dubbele fout wordt expliciet als beheerderinterventie gemeld.
6. Meld u na herstel aan met een account uit de herstelde back-up. Het tijdelijke account van de lege installatie kan door het herstel zijn vervangen. Controleer foto's, taak-/locatieverwijzingen, voorraad, planning, accounts en instellingen. Test opnieuw onderhoudsgeneratie en mobiele synchronisatie.
7. Verbind of controleer externe diensten opnieuw indien een provider oude tokens heeft ingetrokken. Schakel pas na acceptatie de productie-URL om en houd de oude app gestopt om twee schrijvers te voorkomen.

Controle- en resultaatbestanden staan buiten de teruggezette database, zodat de herstelopdracht niet door het herstel zelf verdwijnt. De helper heeft een gedeelde lock en een duurzaam hersteljournaal. Bestanden met onveilige paden, symlinks of speciale bestandstypen worden geweigerd. De versleutelde instellingen-sleutel maakt deel uit van het volledige archief; losse kopieën van alleen de database zijn geen volledige herstelbron.

Handmatig uploaden van een herstelarchief ondersteunt maximaal 20 GiB. Voor grotere archieven gebruikt u de OneDrive-herstelroute (maximaal 250 GiB per archief), met voldoende vrije ruimte op de NAS voor het archief, uitgepakte gegevens en de terugvalkopie.

## Bewaring en aantoonbare herstelbaarheid

Stel de bewaartermijn in de UI bewust in. Verwijdering van oudere lokale archieven gebeurt alleen na een geslaagde nieuwe back-up; de nieuwe back-up blijft behouden. Beheer de externe bewaartermijn afzonderlijk. ZFS-snapshots blijven nuttig als aanvullende bescherming; een kopie uitsluitend op dezelfde NAS dekt verlies van die NAS niet af.

Leg bij iedere herstelproef archiefdatum, versie, begin-/eindtijd, controle van aantallen en fotohashes vast. RPO volgt het laatste bruikbare herstelpunt; RTO moet op de werkelijke dataset en doelhardware worden gemeten. Het testrapport in TEST_DEPLOYMENT.md vermeldt precies welke uitvoering daadwerkelijk is getest.

## Compatibiliteit voor beheer en ontwikkeling

De oudere `age`-CLI-scripts blijven beschikbaar voor bestaande beheersituaties en gebruiken dezelfde exclusieve lock. Zij zijn niet de standaardgebruikersroute. Oude archieven zonder volledige configuratiemap vereisen aanvullende secrets uit de beheerkluis. De moderne UI-route gebruikt `.twb`-archieven met een volledige configuratiesleutel en maakt shellcommando's voor normaal back-upbeheer overbodig.
