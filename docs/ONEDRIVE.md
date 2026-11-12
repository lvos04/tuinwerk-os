# OneDrive aansluiten en herstellen

Open **Beheer → Instellingen → OneDrive**. Alle verbindingsinstellingen, back-upplanning en herstelacties verlopen via de applicatie. Er worden geen Microsoft-wachtwoorden of tokens in de browser of mobiele app opgeslagen.

## Eenmalige Microsoft-appregistratie

Omdat TuinWerk op de eigen server draait, is een eigen Microsoft-appregistratie nodig. Er is geen ingebouwde gedeelde client-ID. Gebruik [Microsoft Entra App registrations](https://entra.microsoft.com/) en maak een registratie voor TuinWerk OS:

1. Kies ondersteunde accounttypen passend bij het account: persoonlijke Microsoft-accounts en/of werk-/schoolaccounts. Gebruik voor beide de optie voor meerdere organisaties én persoonlijke Microsoft-accounts.
2. Open **Authentication → Advanced settings** en zet **Allow public client flows** aan. Device-code-aanmelding heeft geen redirect-URL of client secret nodig.
3. Voeg onder **API permissions → Microsoft Graph → Delegated permissions** `Files.ReadWrite.AppFolder` en `offline_access` toe. Een organisatie kan toestemming van de eigen Microsoft-beheerder vereisen.
4. Kopieer **Application (client) ID** naar het OneDrive-formulier in TuinWerk. Kies `consumers` voor persoonlijk, `organizations` voor werk/school, of `common` voor beide. Een specifiek tenant-ID is ook mogelijk.
5. Klik **Verbinden**. Open uitsluitend de getoonde Microsoft-aanmeldpagina en voer de getoonde code in. TuinWerk vraagt niet om het Microsoft-wachtwoord. Na toestemming verschijnt de verbonden status.

De minimale appfoldermachtiging werkt met persoonlijke en werk-/school-OneDrive. TuinWerk gebruikt uitsluitend `Apps/<naam van de Microsoft-app>/<ingestelde submap>`. De standaard submap is `TuinWerk Backups`. Het formulier kiest geen willekeurige map elders op de OneDrive. Zie [Microsoft Graph appfolderdocumentatie](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder).

## Wat wordt opgeslagen

Een complete back-up bevat database, uploads, exports en de herstelbare applicatieconfiguratie, inclusief de lokale sleutel waarmee instellingen versleuteld zijn. Het archief wordt vóór upload versleuteld met AES-256-GCM en een met scrypt afgeleide sleutel. Bewaar de back-upwachtzin afzonderlijk en veilig; zonder die wachtzin kan de back-up niet worden teruggezet.

OneDrive ontvangt `<unieke-id>.twb` en een klein `<unieke-id>.manifest.json`. Het manifest bevat alleen tijd, formaatversie, omvang, SHA-256-controlehash en de lijst van datasets; geen wachtwoorden, tokens of bedrijfsinhoud. Het manifest wordt pas geplaatst nadat het volledige archief geüpload is. Andere bestanden in de appfolder worden genegeerd en nooit automatisch verwijderd.

Grote bestanden worden gestreamd in blokken van 3,125 MiB (10 × 320 KiB), zonder het hele archief in geheugen te laden. Uploadsessies worden versleuteld en duurzaam bijgehouden. Na een onderbreking controleert TuinWerk bij Microsoft het eerstvolgende ontbrekende blok en hervat het vanaf dat punt. Een verlopen sessie wordt veilig vervangen. Onderbreking tijdens serveronderhoud kan daarom de overdracht uitstellen zonder een complete lokale back-up te verliezen. Overdrachtsstatus en bytevoortgang zijn zichtbaar in de applicatie.

## Herstel

Kies in **Back-ups** een gecontroleerd OneDrive-archief en start eerst de herstelvoorvertoning. TuinWerk downloadt het archief naar een tijdelijke herstelmap, controleert grootte en SHA-256, en laat de herstelservice vervolgens de versleuteling en inhoud controleren. Een onvolledig of afwijkend bestand wordt niet beschikbaar gemaakt voor herstel. Bevestig pas daarna het terugzetten via de expliciete herstelactie.

Een herstelde Microsoft-refresh-token kan inmiddels verlopen of vervangen zijn door tokenrotatie. Dat betekent niet dat het database-/bestandsherstel mislukt is. Verbind OneDrive na herstel zo nodig opnieuw via hetzelfde Microsoft-aanmeldscherm. Controleer ook de server-URL en bereikbaarheid van mobiele apparaten na verhuizing.

**Verbinding verbreken** wist de lokale refresh-token en annuleert lopende aanmeldcodes. Reeds opgeslagen OneDrive-back-ups blijven staan. Voor intrekking van de toestemming bij Microsoft zelf gebruikt u ook de Microsoft-account-/organisatiepagina voor appmachtigingen.

## Verificatie en grenzen

Automatische tests gebruiken een echte geïsoleerde PostgreSQL-database en gesimuleerde Microsoft-antwoorden. Ze controleren autorisatie, versleutelde tokens, pollingregels, onderbroken/hervatte upload, controlehashes, ongeldige overdrachthosts en gelijktijdig verbinden/verbreken. Echte accountaanmelding, organisatiebeleid, opslagquota en daadwerkelijke Microsoft-bezorging moeten met het eigen account worden getest. Zonder die externe aanmelding claimt de applicatie geen verbonden OneDrive-account.

De huidige archieflimiet is 250 GiB per bestand. De lijst accepteert maximaal 2.000 eigen back-upmanifesten in de ingestelde submap. Er vindt geen stilzwijgende verwijdering plaats; bewaarbeleid en beschikbare OneDrive-opslag blijven zichtbaar te beheren.
