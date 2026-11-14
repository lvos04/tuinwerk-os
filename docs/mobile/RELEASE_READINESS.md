# Native releasecontrole 0.2.0

Uitgevoerd op 12 november 2026 op de Linux-bouwomgeving. Dit dossier beschrijft bron- en bundelcontrole; er is nog geen ondertekende App Store- of Google Play-build geproduceerd of ingediend.

## Uitgevoerde controles

- Beide definitieve Expo/Hermes-exports geslaagd na de laatste wijziging aan de systeemfotokiezer: Android 2,62 MB (`index-76993bc9c9464b272b16e5d39d2e6e70.hbc`), iOS 2,61 MB (`index-4d5456ccb5333bb21e2bd258b58f1117.hbc`).
- Expo public-config en native introspection geslaagd. Gegenereerde iOS-config heeft geen microfoontoestemming; Android verwijdert microfoon, locatie, advertentie-ID, overlay en brede foto/video/opslagtoestemmingen expliciet bij manifestmerge. De fotokiezer gebruikt de systeemselectie; camera vraagt afzonderlijk toestemming.
- Releasepreflight: bronconfiguratie geslaagd, drie regressietests geslaagd. Een leeg apparaatverslag wordt afgewezen als bewijs van een 24-uursproef; onveilige/lokale store-URLs worden afgewezen; diagnostiek toont geen tokeninhoud.
- EAS-profielen gebruiken CLI 27.7.2, Android API 36 en Xcode 26.0. App Store-build is een store-distributie; Play-build is AAB. Upload blijft een afzonderlijke handmatige workflowkeuze en publiceert niet automatisch naar alle gebruikers.
- Originele iconen, splash en Play-featuregraphic aanwezig. iOS-icoon is 1024×1024 zonder alfa. Echte apparaatscreenshots moeten nog met de definitieve ondertekende build worden gemaakt.

## Nog benodigde externe gegevens en uitvoering

In deze werkomgeving ontbreken een gekoppeld EAS-project, geldige Expo-aanmelding, Apple/Google-publicatieaccounts, signingcredentials, daadwerkelijke App Store-app-ID en publiek bereikbare reviewserver met de eigen contact- en privacygegevens. Daarom meldt de preflight `storeReady: false`. Bundel-identifiers moeten door de uitgever worden bevestigd voordat de eerste store-build wordt gemaakt.

De uitgever moet de Firebase-clientconfig als EAS-filevariabele `TUINWERK_GOOGLE_SERVICES_FILE` configureren én de afzonderlijke FCM-v1-servercredential in EAS Credentials koppelen. Voor iOS is APNs nodig. Een Expo-project-ID op zichzelf bewijst geen werkende pushbezorging. Uploadsleutels voor Play/App Store Connect zijn bovendien andere credentials dan push- of signingcredentials.

Er was geen fysiek Android- of iOS-toestel beschikbaar. Camera, QR, biometrie, push, daadwerkelijke 24 uur offline, hervatting na procesbeëindiging, echte store-installatie en upgrade zijn daardoor nog niet fysiek bewezen. De definitieve ondertekende IPA/AAB moet ook op samengevoegde manifesten, privacy-redencodes van alle SDK's en daadwerkelijke permissies worden gecontroleerd. Geen storegoedkeuring of juridische naleving wordt hiermee geclaimd.

Gebruik [STORE_RELEASE.md](STORE_RELEASE.md) voor accounts, bouwen en indienen, [MOBILE_DEVICE_ACCEPTANCE.md](MOBILE_DEVICE_ACCEPTANCE.md) voor de apparaatproef en [DATA_PRIVACY.md](DATA_PRIVACY.md) voor de feitelijke datastromen en storeformulieren. Het veilige reviewerfixture-script gebruikt uitsluitend expliciet aangewezen fictieve reviewdata en is hier niet tegen een echte reviewserver uitgevoerd.
