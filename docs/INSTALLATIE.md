# Installeren met de standaard TrueNAS Custom App

Installeer TuinWerk OS als **één standaard Custom App** met de gewone invulvelden. Daarna maakt u de beheerder aan en stelt u de toepassing in via de webinterface.

## De noodzakelijke TrueNAS-velden

Kies **Apps → Discover Apps → Custom App → Install Custom App** en vul in:

| Veld | Waarde |
|---|---|
| Application name | `tuinwerk` |
| Image repository | `ghcr.io/lvos04/tuinwerk-os` |
| Image tag | `0.2.0-rc.1` (gebruik bij een latere release de tag uit die releasebeschrijving) |
| Container port | `8080`, TCP |
| Host port | Een vrije poort, bijvoorbeeld `30080` |
| Storage type | Host Path |
| Host path | Uw blijvende dataset, bijvoorbeeld `/mnt/uwpool/apps/tuinwerk` |
| Mount path | `/data`, schrijfbaar |

Laat command/entrypoint leeg, Custom User uit, Privileged uit, Host Network uit en de ingebouwde healthcheck aan. Kies het gewone herstartbeleid **Unless Stopped**. Er zijn geen verplichte omgevingsvariabelen, shellcommando's of YAML-bestanden voor de eerste ingebruikname.

Maak de dataset vooraf via TrueNAS **Datasets → Add Dataset**. Geef deze geen algemene SMB-schrijftoegang. De app initialiseert zelf de interne PostgreSQL-, bestanden-, configuratie- en back-upmappen. Behoud dezelfde dataset bij iedere update.

De workflow **Build Custom App image** publiceert release-images naar GitHub Packages. Gebruik uitsluitend een tag waarvan de publicatie werkelijk geslaagd is. De aanwezigheid van workflowcode bewijst niet dat die tag al bestaat. De image is voor x86-64/amd64. Zorg dat de NAS het package mag downloaden; gebruik indien nodig de registrycredentialvelden van TrueNAS.

## Eerste ingebruikname in de browser

1. Open `http://NAS-IP:30080` op het vertrouwde lokale netwerk of via VPN.
2. Open eenmaal de **Logs** van de Custom App in TrueNAS en kopieer de eenmalige installatiecode (`initial_setup_code`). Het welkomstscherm vraagt die code, uw naam, e-mailadres en een sterk wachtwoord voor de eerste beheerder. De code voorkomt dat een andere netwerkgebruiker de lege installatie overneemt; de eerste inrichting sluit zodra het account bestaat.
3. Meld u aan en voeg onder **Beheer** persoonlijke medewerkersaccounts toe.
4. Stel via **Instellingen** onder andere de bedrijfsnaam, app-URL, tijdzone, onderhoudsvooruitblik en gewenste meldingen in. Mail, push en optionele AI worden via de eigen configuratievelden ingesteld.
5. Gebruik de browserinstellingen voor **Back-ups** om een herstelcode te maken, buiten de NAS te bewaren, de planning en bewaartermijn te kiezen en een eerste volledige back-up te starten.
6. Verbind desgewenst **OneDrive** vanuit de webinterface en controleer zowel de lokale back-upstatus als de afzonderlijke cloud-uploadstatus.

De geheime instellingen worden versleuteld opgeslagen. De toepassing genereert zelf de lokale instellingen-sleutel en neemt deze mee in volledige, afzonderlijk versleutelde herstelarchieven. U hoeft daarvoor geen sleutel of `.env`-bestand handmatig te maken.

Gebruik voor normale bedrijfsvoering een geldige HTTPS-route via uw bestaande reverse proxy en VPN. Configureer die URL daarna in de app. Publiceer de HTTP-app-poort, PostgreSQL of de TrueNAS-beheerinterface niet rechtstreeks op internet. DNS, certificaatuitgifte en Microsoft-accounttoestemming blijven voorzieningen van uw eigen netwerk/accounts.

## OneDrive verbinden

De webinterface biedt de verbindingsstappen en een Microsoft-inlogcode. Een geldige Microsoft Application (client) ID voor device-code/public-clienttoegang is nodig; vul die in de app in. Daarna meldt u zich bij Microsoft aan en geeft u toestemming voor uw eigen OneDrive. Er worden geen Microsoft-wachtwoorden of client secrets in de TrueNAS-wizard gevraagd. De juiste accountsoort/tenant en doelmap zijn instelbaar in de UI. Zie ook de OneDrive-handleiding bij de applicatie.

## Controleren en bijwerken

Maak een taak met foto, voeg onderdelenvoorraad toe, voer onderhoud uit en herstart de Custom App. Controleer dat de gegevens bewaard zijn. Voer vervolgens de browsergestuurde herstelproef uit uit BACKUP_HERSTEL.md voordat u de app dagelijks gebruikt.

Maak vóór een update een volledige versleutelde back-up en noteer de image-tag. Wijzig daarna de image-tag in **Edit Custom App** naar de geteste release. Laat de `/data`-mount staan. Migraties lopen automatisch. Teruggaan naar een incompatibele oude versie vereist herstel van de passende volledige back-up op een nieuwe dataset.

## Technische inrichting

Eén Alpine-image beheert PostgreSQL 17, API, Next-webapp, onderhoudsworker, nginx en de beperkte back-uphelper via supervisor. De container begint als root voor procesbeheer; applicatie en database draaien met afzonderlijke gebruikers. De helper accepteert uitsluitend de vastgelegde back-up-/herstelopdrachten vanuit de geautoriseerde API. Er is geen Docker-socketmount of privileged container nodig. Compose-bestanden in de repository zijn ontwikkelvoorzieningen.

Bron voor de GUI-velden: [TrueNAS Custom App Screens](https://www.truenas.com/docs/scale/apps/installcustomappscreens/). Kies de guided wizard **Install Custom App**. De werkelijke installatie op de doel-NAS, de eigen TLS-route en de getekende mobiele releases blijven afzonderlijke acceptatietests.
