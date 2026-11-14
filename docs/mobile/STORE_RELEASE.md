# App Store en Google Play — uitvoerbare releaseprocedure

De primaire distributieroute is een **Android AAB voor Google Play** en een **iOS store-build voor App Store Connect**, met interne Play-tests en TestFlight vóór publieke vrijgave. Marketingversie is 0.2.0. `eas.json` beheert buildnummers via EAS remote versioning. Een Expo-export is een JavaScript-bundel, geen ondertekende store-build.

## Eerst de eigenaar en externe accounts vastleggen

Gebruik het eigen Expo/EAS-account, een Apple Developer-lidmaatschap met App Store Connect-toegang en een Google Play Console-account. De projectidentificaties `nl.tuinwerk.os` zijn bronconfiguratie; controleer vóór de eerste upload of de uitgever ze kan registreren. Een andere identifier vereist een bewuste eenmalige keuze. Verander identifiers of Android-signingkey niet bij een gewone update.

Vanuit `apps/mobile` kan de bevoegde beheerder `npx eas-cli@27.7.2 login` en `npx eas-cli@27.7.2 init` gebruiken om het echte project te koppelen. Bij de dynamische configuratie kan EAS vragen de publieke project-ID expliciet over te nemen; vanuit repositoryroot kan dat met `TUINWERK_EAS_PROJECT_ID=<eigen UUID> TUINWERK_EXPO_OWNER=<eigen eigenaar> node scripts/mobile-release.mjs --apply`. Project-ID en eigenaar zijn geen signingsecret. Voer vervolgens de interactieve credentialconfiguratie uit met `eas credentials --platform android` en `eas credentials --platform ios`. Bewaar de Android-uploadkey en Apple-herstelgegevens in de eigen kluis.

De gekozen buildservers zijn gecontroleerd tegen de officiële [EAS-infrastructuur](https://docs.expo.dev/build-reference/infrastructure/): Android `ubuntu-24.04-jdk-17-ndk-r27b` en iOS `macos-sequoia-15.6-xcode-26.0`. De geïnstalleerde React Native-versie gebruikt target/compile API 36. Apple verlangt sinds 28 april 2026 Xcode 26 met iOS 26 SDK voor uploads ([Apple-eis](https://developer.apple.com/news/upcoming-requirements/)); deze pin sluit daarop aan. Controleer actuele store-eisen opnieuw bij de feitelijke indiening.

## Concrete builds

Vanuit `apps/mobile`, na account- en credentialconfiguratie:

```sh
npx eas-cli@27.7.2 build --platform android --profile production
npx eas-cli@27.7.2 build --platform ios --profile production
```

De eerste opdracht maakt een ondertekende AAB; de tweede een iOS store-IPA. Voor een extra interne Android-installatie kan `--profile android-apk` worden gebruikt. Voor TestFlight wordt eveneens de store-distributie gebruikt (`production` of de gelijkwaardige alias `testflight`), niet een ad-hoc/internal iOS-profiel. `simulator` is uitsluitend een simulatorhulpmiddel en levert geen toestelacceptatie op.

Android-push vereist de eigen Firebase-clientconfiguratie en de afzonderlijke FCM-v1-servercredential in EAS Credentials. Deze private servercredential verschilt van het Firebase-clientbestand en van de Play-uploadsleutel. Configureer `TUINWERK_GOOGLE_SERVICES_FILE` als EAS-filevariabele in de gebruikte buildomgeving; `app.config.js` leest die uitsluitend tijdens de build. Voor iOS moet de eigen APNs-configuratie geldig zijn. Zonder deze voorzieningen blijft gewone servercommunicatie bruikbaar, maar pushbezorging is geen geslaagde acceptatiepoort.

## Herhaalbare GitHub-workflow

**Build and stage native store releases** is handmatig te starten. Kies `android-play`, `ios-app-store` of `android-apk`. De standaard is alleen bouwen. De afzonderlijke `submit`-keuze uploadt naar een **Play internal draft** of **App Store Connect/TestFlight**; zij publiceert niet vanzelf een openbare store-release.

Configureer in de GitHub-environment `mobile-release`:

| Soort | Namen |
|---|---|
| Expo-secret | `EXPO_TOKEN` |
| Publieke projectmetadata | `EAS_PROJECT_ID`, `EXPO_OWNER`, `IOS_BUNDLE_IDENTIFIER`, `ANDROID_APPLICATION_ID` |
| Echte uitgever- en reviewmetadata | `PUBLIC_PRIVACY_URL`, `PUBLIC_SUPPORT_URL`, `PUBLIC_ACCOUNT_DELETION_URL`, `SUPPORT_EMAIL`, `COPYRIGHT_OWNER`, `REVIEW_SERVER_URL` |
| App Store-record | `APP_STORE_CONNECT_APP_ID` |
| Apple-uploadsecret | `APPLE_ASC_API_KEY_P8`; daarnaast `APPLE_ASC_KEY_ID` en `APPLE_ASC_ISSUER_ID` als metadata |
| Play-uploadsecret | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` met de benodigde apprechten |

De workflow controleert Expo-authenticatie, types en native tests; wacht op een echt geslaagde EAS-build; bewaart build-ID/readinessrapport; en gebruikt tijdelijke uploadkeys met modus 0600. Account- en keystoreaanwezigheid worden niet gefingeerd. Google kan voor een nieuwe app een eerste handmatige Console-inrichting/upload en aanvullende testvoorwaarden verlangen; voltooi die in het eigen account.

Voor upload controleert `scripts/mobile-release.mjs --require-store` niet alleen URL-vorm maar ook bereikbaarheid van privacy/support/verwijderpagina's en `ready=true` op de reviewserver `/api/public/info`. Vul de echte bedrijfscontacten via serverbeheer in. Een intern NAS-adres of VPN-only backend is niet geschikt voor een externe store-reviewer.

## Reviewserver en reviewmateriaal

Gebruik een afzonderlijke openbaar bereikbare HTTPS-testbackend met fictieve gegevens. Verstrek een medewerker en waar nodig een aparte beheerder via de afgeschermde reviewvelden van App Store Connect/Play Console. Maak review niet afhankelijk van uw bedrijfs-VPN, onbeheerde MFA of echte productiegegevens. Pas dezelfde serverautorisatie en HTTPS toe als in productie.

`scripts/reviewer-fixture.mjs` maakt uitsluitend na `REVIEW_FIXTURE_CONFIRM=ISOLATED_TEST_SERVER` fictieve locaties, machine, taken en onderdelen. Benodigde invoer: `REVIEW_BACKEND_URL`, `REVIEW_OWNER_EMAIL/PASSWORD`, `REVIEWER_EMAIL/PASSWORD` en optioneel `REVIEWER_ADMIN_EMAIL/PASSWORD`. Het script controleert publiek geconfigureerde contactinformatie en print geen wachtwoorden. Een bestaande reviewer wordt niet stilzwijgend van wachtwoord of rol veranderd.

De basislisting staat in `apps/mobile/store/metadata.json`; onbekende contactvelden zijn bewust leeg. Originele iconen, adaptive foreground, splash, Play-icon en feature graphic zijn opgenomen. Maak de vereiste telefoon-/tablet-screenshots van de echte getekende app op de ondersteunde formaten. De repository bevat geen als toestelbewijs vermomde webscreenshots. Voeg aan de reviewnotities de server-URL, accounts, kernscenario's, uitleg van de eigen bedrijfslogin en optionele integraties toe.

Vul App Privacy en Data safety aan de hand van DATA_PRIVACY.md en de daadwerkelijk ingeschakelde configuratie in. De eigen bedrijfslogin heeft geen sociale login als primaire authenticatie; OneDrive-koppeling is een afzonderlijke integratie. Claim geen algemene store-compliance alleen omdat de code bouwt: accountverwijdering, gebruikersinhoud/moderatie, AI-toestemming, reviewerbereikbaarheid, metadata en native gedrag moeten ook beoordeeld worden.

## Go/no-go

Publieke vrijgave volgt pas na een geslaagde ondertekende build, installatie/upgrade op echte iPhone en Android, ingevulde toestelrapporten inclusief werkelijk 24 uur offline, gecontroleerde accountverwijdering, push met de eigen credentials en goedgekeurde storeformulieren. Gebruik MOBILE_DEVICE_ACCEPTANCE.md. Verplaats een Play internal draft pas daarna naar de bedoelde release; kies de publicatie-instelling in App Store Connect bewust.
