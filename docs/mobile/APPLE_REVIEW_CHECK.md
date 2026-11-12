# Apple-controle voor deze versie

Gecontroleerd op 12 november 2026 tegen [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [accountverwijdering](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/) en [actuele uploadvereisten](https://developer.apple.com/news/upcoming-requirements/). Dit is een controle van de uitvoering en voorbereiding; geen goedkeuringsgarantie.

| Onderwerp | Concrete uitvoering in TuinWerk | Nog vaststellen vóór indiening |
|---|---|---|
| Volledige, bruikbare app (2.1) | Native werkstromen, foutmeldingen, offlinewachtrij; reviewfixture en stapsgewijze reviewinstructies | Getekende app op echte toestellen, bereikbare HTTPS-reviewserver en accounts |
| Eerlijke metadata (2.3) | Nederlandse listing, originele iconen, beschrijving van eigen server/account | Echte iPhone/iPad-screenshots, correcte leeftijdsvragen, definitieve uitgeversinformatie; geen beta als publieke storeversie indienen |
| Gebruikersinhoud (1.2) | Instelbaar servertekstfilter, melden van taken/reacties/bijlagen, beheerdersbeoordeling, verbergen en accountblokkering | Organisatie moet meldingen daadwerkelijk tijdig behandelen; filtering is geen volledige automatische beeldmoderatie |
| Privacy en verwijderen (5.1.1) | Openbare pagina's, herauthenticatie en echte verwijdering van account/toegang/persoonlijke gegevens; duurzame bestandopschoning | Echte contactgegevens en bewaarbeleid invullen; gedeelde vrije teksten en historische back-ups correct behandelen |
| AI en gegevensdoorgifte (5.1.2) | Provider/model zichtbaar vóór toestemming; verzoek gebonden aan actuele providerconfiguratie | Controleer afspraken en feitelijke verwerking door gekozen providers |
| Login (4.8) | Eigen organisatieaccounts; Microsoft is alleen een back-upkoppeling | Bij toekomstige sociale primaire login de Apple-regel opnieuw beoordelen |
| SDK en manifests | Xcode 26/iOS 26-buildprofiel, geen tracking, gegevenscategorieën en SDK-privacy-manifests | Gecombineerde manifesten, vereiste API-redenen en permissies in echte IPA controleren |
| Publicatiegegevens | Onbekende waarden worden niet verzonnen; preflight controleert metadata en publieke pagina's | Apple-lidmaatschap, App Store-record, rechten, DSA-uitgeversstatus waar van toepassing, privacyformulieren en encryptieverklaring |

Camera, biometrie en push zijn aanvullende functies; weigeren van toestemming mag gewone handmatige taakbediening niet blokkeren. Test dit expliciet op echte hardware. De app heeft geen betalingen of in-appaankopen; er is geen fictieve aankooppagina toegevoegd.

Gebruik `STORE_RELEASE.md`, `DATA_PRIVACY.md` en `MOBILE_DEVICE_ACCEPTANCE.md` voor de concrete indienings- en toestelstappen. Bewaar reviewerwachtwoorden uitsluitend in de afgeschermde storevelden, niet in Git of screenshots. Een private NAS die Apple niet kan bereiken is geen werkende reviewomgeving.
