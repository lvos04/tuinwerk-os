# Feitelijk privacy- en storeformulierwerkblad

Dit werkblad beschrijft gegevensstromen in de broncode. Het is geen ingevulde juridische verklaring of bewijs dat Apple/Google de app hebben goedgekeurd. De uitgever blijft verantwoordelijk voor de uiteindelijke App Privacy-, Data safety-, leeftijds- en inhoudsantwoorden, de eigen hosting en geselecteerde providers.

| Gegevens | Doel en bestemming | Verplicht/keuze |
|---|---|---|
| Naam, e-mailadres, gebruikers-ID, rol | Account en samenwerking op de ingestelde eigen TuinWerk-server | Organisatieaccount |
| Taken, opmerkingen, checklists, planning en werktijd | Werkadministratie op de eigen server; lokaal gecachet voor offlinegebruik | Ingevoerde werkgegevens |
| Foto's, annotaties, documenten | Bewijs/handleidingen bij werk en machines; toestelcache en eigen server | Gebruiker kiest opname/upload |
| Zelf ingevoerde locatie-/machinenamen | Identificatie van werkobjecten; geen GPS-toestellocatie | Werkgegevens |
| Sessietokens | Aanmelding; Keychain/Keystore op toestel en gecontroleerde server | Voor ingelogd gebruik |
| Push-token en gekoppelde gebruiker | Berichten via ingestelde Expo/APNs/FCM-route | Optioneel en toestemming |
| Tekst voor AI-voorstellen | Ingestelde externe AI-provider na afzonderlijke expliciete actie/toestemming | Optioneel; uitschakelbaar |
| OneDrive-accounttoestemming en tokens | Servergestuurde kopie/herstel van versleutelde back-ups via Microsoft Graph | Alleen na beheerderkoppeling |
| Versleutelde volledige back-ups | Database, bestanden en configuratie naar gekozen opslag | Beheerdersactie/planning |
| Beveiligings-/auditgebeurtenissen | Toegang, wijzigingen en gegevensintegriteit op de eigen server | Bedrijfsbeheer; bewaartermijn vaststellen |

Er zijn geen advertentie-SDK's, advertentie-ID's, contactenboektoegang, GPS-permissies of eigen analyticsdienst toegevoegd. Biometrie loopt via het besturingssysteem; de app ontvangt geen biometrische templates. Spraakinvoer gebruikt het systeemtoetsenbord; de app vraagt geen eigen microfoonrechten. De beoordeling van externe toetsenbord-/OS-diensten ligt bij de gekozen toestellen en het bedrijfsbeleid.

De iOS-configuratie declareert geen tracking en noemt naam, e-mail, user-ID, foto's/video's, andere gebruikersinhoud en device-ID voor appfunctionaliteit. Dat laatste dekt de optionele gekoppelde push-token. De gegevens zijn aan accounts verbonden; geef daarom niet zonder onderzoek "Data Not Collected" aan alleen omdat de backend zelf wordt gehost. Onderzoek in het storeformulier welke verwerking onder de uitgever, de klantorganisatie en verwerkers valt, welke gegevens optioneel zijn en of providerinstellingen verdere doorgifte veroorzaken.

## Privacy manifest en native permissies

De oorspronkelijke app voegt geen verzonnen required-reason-API-codes toe. De geïnstalleerde SDK's leveren hun eigen manifests, onder andere `expo-file-system/ios/PrivacyInfo.xcprivacy`, `expo-notifications/ios/PrivacyInfo.xcprivacy`, React Native React/ReactCommon en de relevante pods. Expo/Pods voegen deze bij de native build samen. De file-systemmanifest noemt bestandsmetadata en schijfruimte met de redenen uit die SDK; dit werkblad claimt geen nieuwe grondslag buiten de SDK-verklaring.

Controleer de werkelijk gegenereerde `PrivacyInfo.xcprivacy`, Info.plist en AndroidManifest in de getekende artifact. De bronconfiguratie vraagt alleen camera/fotoselectie/Face ID en notificaties waar nodig; microfoon en GPS zijn expliciet geblokkeerd op Android. Android-cloudbackup is uitgezet om lokale werkcache en accountgegevens niet ongemerkt via OS-backup over te dragen. De iOS-encryptie-instelling gaat uit van standaard transport- en platformbeveiliging; herbeoordeel die bij wijzigingen in clientcryptografie.

## Publieke pagina's en verwijdering

Publiceer de echte privacy-, support- en accountverwijderingspagina's en vul echte contactgegevens en bewaartermijnen in serverbeheer in. Test de accountverwijderingsroute in de app en op de website met een apart testaccount, inclusief sessie-intrekking en de behandeling van gedeelde historische werkregistraties. Deactiveren of alleen een supportadres noemen is geen vervanging voor een vereiste verwijderingsfunctie ([Apple 5.1.1](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/)).

Werknotities en foto's kunnen gebruikersinhoud zijn. Beoordeel en test meldings-/moderatie-/blokkeermechanismen, contactmogelijkheden en de organisatievoorwaarden tegen de toepasselijke store-eisen; de private bedrijfscontext maakt een generieke complianceclaim niet vanzelf geldig. Leg voor optionele AI vóór verzending uit welke gegevens naar welke ingestelde provider gaan, met expliciete toestemming. Zie de eigen `/community`, `/privacy`, `/support` en `/account-deletion`-pagina's van de deployment en controleer dat hun inhoud overeenkomt met de ingeschakelde functies.
