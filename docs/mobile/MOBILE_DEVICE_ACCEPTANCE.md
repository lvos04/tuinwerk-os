# Werkelijke iPhone-/Android-acceptatie en 24 uur offline

Voer deze proef afzonderlijk uit op een fysieke iPhone met de TestFlight/store-build en een fysiek Android-toestel met de Play internal build. Leg per toestel een kopie van `docs/acceptance/mobile-session.template.json` vast. Alle resultaten beginnen op `pending`; er zijn geen vooraf ingevulde geslaagde apparaatresultaten.

## Voorbereiding

Gebruik een geïsoleerde HTTPS-backend met fictieve machine-, locatie- en voorraadgegevens, twee persoonlijke testaccounts en één artikel met precies één onderdeel. Leg de volledige Git-commit, marketingversie, buildnummer, EAS/store-artifact-ID, toestelmodel en OS-versie vast. Gebruik een toestel-label in plaats van IMEI/privéapparaatgegevens. Bewaar screenshots/video en bijbehorende API-/auditcontroles in een afgeschermde testmap.

Installeer via TestFlight/Play en test ook een upgrade van de vorige getekende build met bestaande lokale concepten. Een emulator, Expo Go, JavaScript-export of losse typecheck geldt niet als deze installatieproef. Controleer dat de app geen vaste NAS-hostname in de build nodig heeft.

## Dag 1: online en onderbrekingen

1. Log in, laad werk en catalogus, maak een snelle melding met camera, scan een machinelabel, bekijk historie en voeg annotatie/opmerking/checklist toe. Controleer het resultaat op web.
2. Weiger camera-/fototoegang en probeer opnieuw: begrijpelijke feedback en behoud van de ingevulde taak. Test grote tekst, schermlezerlabels en grote aanraakdoelen. Test biometrische terugkeer of correct gedrag als het toestel die functie niet biedt.
3. Maak een taak met meerdere foto's. Onderbreek de verbinding tijdens upload, beëindig de app en heropen. Concept en lokale beelden moeten blijven bestaan tot serverbevestiging. De uiteindelijke serverregistraties mogen bij retry niet dubbel ontstaan.
4. Laat account B dezelfde taak online wijzigen terwijl A een oudere versie heeft. Controleer dat A bewust een conflict oplost; een andere onafhankelijke taak moet kunnen synchroniseren. Test uitloggen/ander account: geen verzending of inhoud van het vorige account onder de nieuwe sessie.
5. Stuur een echte push met de eigen APNs/FCM-configuratie. Test voorgrond, achtergrond en afgesloten app. Een tik opent alleen het juiste object voor dezelfde gebruiker/server; een oude of verkeerd geadresseerde melding toont geen data van een ander account.

## Werkelijk 24 uur offline

Noteer `disconnectedAt` in UTC en maak een bewijsopname van de toestelklok en offline-indicator. Zet wifi en mobiele data uit. Verplaats de systeemklok niet en gebruik geen versnelde simulatietijd.

Maak offline meerdere taken, foto's, checklistwijzigingen, opmerkingen en voorraadconcepten. Het getoonde bevestigde voorraadsaldo mag door een concept niet als serverbevestigd veranderen. Leg de wachtrijgrootte vast. Sluit de app geforceerd af, herstart het toestel en open opnieuw zonder netwerk. Controleer dat aantallen, foto's en invoer terugkomen. Laat de verbinding ten minste 24 echte uren uitgeschakeld en leg relevante batterij-/OS-onderbrekingen vast.

Laat ondertussen account B op het andere toestel één overlappende taak wijzigen en eveneens het laatste onderdeel claimen. Verbind na minimaal 24 uur opnieuw en noteer `reconnectedAt`. Controleer de verwerking, herstelbare uploadfouten en bewuste conflictkeuzes. Precies één van de twee laatste-onderdeelmutaties mag definitief worden geaccepteerd; de andere krijgt een duidelijk conflict en het eindsaldo is nul. Controleer de servermutaties/auditregels, niet alleen de schermtekst.

## Na herstel van verbinding

Vergelijk op web en beide toestellen de aangemaakte taken, foto's, checklist, werktijd, voorraad en machinehistorie. Bevestig dat geen operatie verloren of dubbel verwerkt is. Handel conflicten bewust af; noteer dat geen onbesproken conflict resteert. Test een export/deelactie. Test de beheerinterface voor back-up/herstel uitsluitend op de geïsoleerde backend met de daarvoor vastgelegde herstelproef.

Test accountverwijdering met een apart wegwerpaccount: herauthenticatie, sessie-intrekking, lokale gegevensopruiming en beleid voor gedeelde werkhistorie. Test dat verwijderen van de laatste beheerder niet tot onbeheerde bedrijfsdata leidt. Controleer de publieke verwijder-/supportinformatie zonder login.

## Bewijs en controle

Vul ieder geval met `passed` of `failed` en verwijs naar concrete bewijsbestanden. Registreer fouten met reproduceerbare stappen en maak na een fix een nieuwe run; overschrijf eerdere mislukte verslagen niet. Controleer het record met:

```sh
node scripts/check-device-acceptance.mjs /pad/naar/ingevuld-toestelverslag.json
```

Deze controle toetst volledigheid en tijdstempelconsistentie, waaronder ten minste 24 uur tussen offline en online. Zij kan niet zelfstandig bewijzen dat een fysiek toestel de handelingen werkelijk uitvoerde. De uitvoerder en reviewer moeten de bewaarde bewijsstukken beoordelen. De lege template wordt expliciet afgewezen.

De automatische aanvulling staat in `apps/api/test/mobile-recovery.integration.test.ts`: de daadwerkelijke queue-engine spreekt een echte HTTP/PostgreSQL-server aan, verliest serverbevestigingen en laadt duurzame invoer opnieuw. Dat toetst protocol/idempotentie en concurrentie; het vervangt native SQLite, cameratoegang, toestelbeëindiging, batterijgedrag of de 24-uursproef niet.
