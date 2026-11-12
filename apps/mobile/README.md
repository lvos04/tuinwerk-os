# TuinWerk native apps

Dit is een Expo/React Native-app voor **iOS en Android**, geen PWA. Alle schermen gebruiken dezelfde geauthenticeerde server-API als de webapp. De server-URL wordt bij aanmelden ingesteld; productie vereist HTTPS. Android-emulatorontwikkeling kan `http://10.0.2.2:3001` gebruiken.

## Ontwikkeling

Vanaf repositoryroot: `npm ci`, daarna `npm run start --workspace=@tuinwerk/mobile`. Voor een native developmentbuild: `npm run android --workspace=@tuinwerk/mobile` of op macOS met Xcode `npm run ios --workspace=@tuinwerk/mobile`. Camera, SQLite, SecureStore, biometrie, SVG-annotaties en bestanden delen vereisen de native runtime. Expo Go is niet de release-route; push moet in een eigen build getest worden.

`npm run typecheck --workspace=@tuinwerk/mobile` en `npm run test --workspace=@tuinwerk/mobile` controleren types en wachtrijregels. `npx expo export --platform android` / `--platform ios` in deze map controleert bundeling, maar bouwt **geen ondertekende APK/IPA** en bewijst geen toestelwerking.

## Geïmplementeerd

- Instelbare backend, beveiligde tokenopslag, access-tokenverversing en intrekken bij online uitloggen.
- Home, taken, planning, voorraad, machines/locaties, meldingen en beheer van lokale concepten.
- Snelle storing, prioriteit, locatie, machine, toewijzing, checklist, opmerkingen, statussen en handmatige tijdregistratie en lokaal duurzaam start/pauze/stop-timer; onderdelenverbruik aan een taak koppelen.
- Camera/fotobibliotheek, QR-scanner en fotoannotatie met pijlen/cirkels/tekst. Annotatie is een afzonderlijke JPEG; het oorspronkelijke beeld blijft bestaan en wordt apart geüpload.
- SQLite-cache en duurzame seriële wachtrij, gescheiden per server én gebruiker. Concepttaken zijn lokaal zichtbaar en opeenvolgende wijzigingen krijgen voorspelde versies. Externe concurrerende wijzigingen geven een zichtbaar conflict; de server blijft beslissend.
- Foto's worden vóór wachtrijregistratie naar de documentdirectory gekopieerd. Pas na serverbevestiging worden lokale wachtrijmedia verwijderd. Fouten of conflicts stoppen afhankelijke operaties.
- Inventarisatie: online telronde starten, lokaal duurzaam getelde aantallen bewaren, verschillen expliciet bevestigen; concurrente voorraadwijziging wordt server-side geblokkeerd.
- Privé/gedeelde werkblokken, jaarlijst van gecachete geplande taken, PDF/Excel/CSV downloaden en delen.
- Push-tokenregistratie en stille uren; geen claim dat push al geconfigureerd is. Optionele biometrische ontgrendeling bij heropenen/background.
- Spraakinvoer via systeemtoetsenbord: tekst is voor opslaan te corrigeren; beschikbaarheid, taal en offlinewerking hangen af van het gekozen toestel/toetsenbord.

## Offline gedrag

De statusbalk toont verbinding en wachtende operaties. Een voorraadconcept wijzigt geen bevestigd saldo. Synchronisatie loopt bij netwerkherstel, hervatten en handmatige opdracht. De app belooft geen permanente achtergronduitvoering op iOS of Android. Er wordt serieel verwerkt zodat een foto niet vóór haar nieuwe taak verstuurd wordt. Een serverconflict bewaart het concept inclusief bestanden. Onder **Meer → Synchronisatie** zijn actuele servergegevens en lokale payload te bekijken; aangepast opnieuw aanbieden is expliciet. Gewijzigde conflicts krijgen pas na bewuste bevestiging een nieuwe operatie-ID op dezelfde wachtrijpositie. Bij onbekende uitkomst mag de oorspronkelijke operatie eerst ongewijzigd worden herhaald. De veldgerichte conflicteditor vraagt bewuste controle vóór nieuwe toepassing.

Let op: het definitief verwijderen van een lokaal concept kan afhankelijke operaties achterlaten. De app waarschuwt hiervoor; verwijder alleen bewust. Lokale SQLite-data is app-sandboxdata, niet versleuteld met SQLCipher; tokens staan in Keychain/Keystore. Verlopen sessies worden veilig vernieuwd; tweede factor en herstelcode zijn bij aanmelden ondersteund. Gebruik toestelversleuteling en schermvergrendeling. Uitloggen bewaart concepten voor hetzelfde account/server; er wordt niets onder de credentials van een andere gebruiker verzonden.

## Native distributie

1. Leg definitieve bundle identifiers vast (`nl.tuinwerk.os` is de configureerbare projectwaarde).
2. Maak een eigen Expo/EAS-project en configureer de project-ID met `eas init`. Er zijn geen account- of signingsecrets opgenomen.
3. Android: `eas build --platform android --profile preview` maakt een ondertekende interne APK met jouw keystore. Test installatie en updates op medewerkersapparaten. Productieprofiel maakt AAB voor eventuele Play-distributie.
4. iOS: vereist macOS/Xcode voor lokale builds of EAS, geldig Apple Developer-account, provisioning en gekozen distributieroute. `eas build --platform ios --profile production`, gevolgd door de geautoriseerde TestFlight/App Store/bedrijfsroute. Een losse IPA is geen universele installatieoplossing.
5. Push: configureer APNs/FCM in de eigen Expo-build, voer de EAS-project-ID onder Meer in en activeer optioneel de servermodule. Stille uren zijn servervoorkeuren. Pushmetadata wordt dan naar Expo/APNs/FCM verstuurd; gebruik deze module alleen na bewuste configuratie.
6. Bewaar signingcertificaten en keystores buiten Git en neem veilige herstelprocedures op in beheer.

## Open acceptatiepoorten

Er zijn in deze uitvoering geen fysieke iPhone/Android-apparaten, Apple/Google-signingaccounts of TrueNAS-host beschikbaar gesteld. Ondertekende builds, camera/QR/annotatie/biometrie op hardware, pushaflevering, 24-uurs offline-/batterijproef en eindgebruikersacceptatie zijn daarom niet als geslaagd gemeld. De testset verifieert het transportprotocol; native SQLite-/camera-/bestandsintegratie moet aanvullend op apparaten worden getest.

De native app bevat aanvullende werkruimtes voor onderhoud/herhaalregels en seizoenssjablonen (maken, wijzigen, activeren en verschuiven), catalogusbeheer en machinehistorie, taaksjablonen, rapportfilters/statistieken/achtergrondexports, gebruikers/sessies/MFA, CSV- en Excelbestandsimport met mapping/voorvertoning/deduplicatie, dashboard- en meldingsvoorkeuren en optionele AI-voorstellen met afzonderlijke toestemming. Deze beheermutaties vereisen verbinding; offline kerninvoer blijft in de wachtrij.

De conflicteditor biedt invoervelden voor taakgegevens, toewijzing, checklist, hoeveelheden en telregels, met vergelijking van serverversie en bewuste toepassing. JSON is alleen als optionele gegevensweergave beschikbaar. Bijlagen van geopende taken worden per account duurzaam gecachet, met een afzonderlijke limiet van 250 MB voor bevestigde media; oude bevestigde media worden bij ruimtegebrek verwijderd. Wachtrijmedia blijven behouden tot bevestiging. Foto's zijn in een vergrootbare galerij te bekijken. Taken/artikelen/saldi worden gepagineerd tot de laatste pagina geladen, met een expliciete fout als de server een pagina blijft herhalen. Nieuwe meldingen resetten machine/locatie/prioriteit tenzij gestart vanuit een machine- of QR-context.

QR-resolutie gebruikt de gecachete catalogus en vraagt synchronisatie wanneer een object ontbreekt. Jaarplanning combineert bevestigde taken met per jaar gecachete serverprognoses uit `/recurrences/forecast`. Prognoses zijn zichtbaar als nog niet gegenereerde werkopdrachten; uitvoeringsintervalprognoses dragen een voorlopig-label. De onderhoudswerkruimte toont herhaalregels en historie. Prognoses maken geen taken aan. De wachtrij is begrensd op 500 operaties en 250 MB foto’s. Cachemedia hebben een afzonderlijk 250 MB-budget; tekst-detailcache-retentie blijft een beheerkeuze. Netwerkfouten hebben een 60-seconden-timeout. Uploadstatus wordt per operatie getoond, zonder byte-percentage. Een fysieke 24-uurs offline-test en herstel van uploads bij app-/OS-onderbreking blijven releasepoorten; JavaScript-tests vervangen die niet.

Expo SDK 54-dependencies zijn met `expo install --check` gecontroleerd. De Metro image-size-dependency is via root override naar de gepatchte 2.1-versie gebracht en wordt met beide platformbundels gevalideerd. Onderhoud/upgrades en advisories moeten vóór distributie opnieuw beoordeeld worden; een bundeltest is geen volledige security-audit.

## Serverinstellingen, OneDrive en herstel vanuit de app

Beheerders openen **Meer → Rapporten, catalogus en beheer → Server en back-ups**. Hier zijn bedrijfsinstellingen, SMTP, AI-budgetten, push en onderhoudsvooruitzicht te wijzigen zonder configuratiebestanden. Geheime waarden blijven leeg bij het heropenen: leeg opslaan behoudt het bestaande geheim; wissen is een afzonderlijke bevestigde actie. De schermen gebruiken versiecontrole en bewaren invoer na een serverconflict. Deze configuratie wordt niet in de offline SQLite-cache opgeslagen.

Bij **Back-ups** maak je een herstelcode, bewaar je die via de deelactie buiten de NAS en bevestig je het bewaren voordat je de nieuwe sleutel opslaat. De dagelijkse tijd, lokale bewaartermijn en OneDrive-kopie zijn instelbaar. Oude OneDrive-archieven worden niet automatisch gewist door de lokale bewaartermijn; oude herstelcodes blijven nodig zolang bijbehorende archieven bestaan.

Bij **OneDrive** voer je de openbare Application-ID van je eigen Microsoft-appregistratie in, kies je accountsoort en appsubmap en open je Microsofts device-code-aanmelding. De app toont alleen de tijdelijke gebruikerscode; device-/access-/refresh-tokens blijven op de server. Voortgang en mislukte overdrachten zijn zichtbaar en een mislukte cloudkopie is opnieuw aan te vragen. Een Microsoft-appregistratie en werkende accountmachtiging blijven externe vereisten.

Herstel ondersteunt lokale archieven, een via de toestelbestandskiezer geüpload UUID.twb-bestand en OneDrive-archieven. Uploads gebruiken de native bestandsuploader met voortgang. De extern bewaarde herstelcode wordt handmatig ingevoerd voor de ontsleutel-/controleproef; pas na een geslaagde proef en de exacte `HERSTEL <archief-ID>`-bevestiging kan de vervangende herstelactie worden gestart. Een herstel kan de huidige sessie beëindigen. Een herstelcode die uitsluitend op een verloren NAS staat, is niet voldoende: bewaar deze onafhankelijk.

De nieuwe instellingen-/back-upschermen zijn getypecheckt en de payloadregels zijn automatisch getest. Werkelijke native OneDrive-aanmelding, grote bestandsuploads en destructief herstel via een fysiek toestel vereisen nog apparaat- en accountacceptatie; de code claimt die tests niet als uitgevoerd.
