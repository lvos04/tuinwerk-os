# TuinWerk OS

Nederlandstalige werkomgeving voor onderhoud, storingen, planning en onderdelenvoorraad in de glastuinbouw. Eén PostgreSQL-backend voor de webapp en zelfstandige Expo/React Native-apps voor iOS en Android.

## Project

| Onderdeel | Locatie | Technologie |
| --- | --- | --- |
| API en migraties | `apps/api` | NestJS, TypeScript, PostgreSQL |
| Webapp | `apps/web` | Next.js, React |
| Native apps | `apps/mobile` | Expo, React Native, SQLite |
| TrueNAS Custom App | `deploy/custom-app`, `docs` | Eén containerimage, installatie via invulvelden |

Het oorspronkelijke [bouwplan](docs/BOUWPLAN.txt) en het [uitvoeringsplan](docs/UITVOERINGSPLAN.md) zijn opgenomen. De volledige productacceptatie omvat ook fysieke mobiele apparaten, signing en een hersteltest op de eigen TrueNAS-host. Raadpleeg het opleverrapport voor uitgevoerde tests en resterende acceptatiepunten.

## Installeren op TrueNAS

Gebruik de standaard **Custom App-interface**, zonder YAML. De gebundelde image bevat web, API, PostgreSQL en achtergrondtaken. Je koppelt één persistente dataset aan `/data` en stelt de webpoort en omgevingsvariabelen in via de interface. Volg de [installatiehandleiding met invultabel](docs/INSTALLATIE.md). Compose-bestanden in deze repository zijn uitsluitend voor ontwikkeling en tests.

## Ontwikkelen

Gebruik Node.js 22 of nieuwer en PostgreSQL 17. Installeer alle workspaces vanuit de repositoryroot:

```sh
npm ci
cp .env.example .env
# Stel DATABASE_URL en overige instellingen in; exporteer de benodigde variabelen.
npm run migrate --workspace apps/api
npm run bootstrap --workspace apps/api
npm run dev:api
# In een tweede terminal:
npm run dev:web
# Voor de native app:
npm run dev:mobile
```

Er zijn geen ingebouwde productieaccounts of standaardwachtwoorden. De bootstrap-procedure maakt de eerste beheerder aan. De mobiele app vraagt de configureerbare HTTPS-API-URL; localhost op een telefoon verwijst naar de telefoon zelf.

## Verificatie

```sh
npm run typecheck
npm test
npm run build
```

Database-integratietests gebruiken een afzonderlijke testdatabase. Gebruik hiervoor nooit productiegegevens. Externe diensten zoals push, e-mail en optionele AI vereisen eigen configuratie; hun beschikbaarheid wordt niet verondersteld.

## Gegevens en veiligheid

Voorraadboekingen en verplaatsingen worden transactioneel verwerkt. Offline mutaties behouden hun operatie-ID bij retries en conflicten worden aan de gebruiker teruggegeven. Planning onderscheidt persoonlijke werkblokken van taakdeadlines. Accounts en rechten worden op de API afgedwongen. PostgreSQL en uploads blijven buiten de applicatiecontainers persistent opgeslagen.

Zie de handleidingen in [docs](docs) voor installatie, back-up, herstel en mobiele distributie. Secrets, signingcertificaten en bedrijfsgegevens horen niet in Git.
