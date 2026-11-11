# Uitvoeringsplan en acceptatie

Bron: BOUWPLAN.txt (aangeleverd Word-document, 11 november 2026). De repository was leeg behalve README. Geen voorbeeldgegevens worden als echte bedrijfsgegevens gepresenteerd.

1. Fundament: npm-monorepo, TypeScript/NestJS API, PostgreSQL, React/Next web en Expo native. Acceptatie: migratie op lege database, login, serverautorisatie en productiebuild.
2. Taken en catalogus: versiecontrole, statusregels, checklist, reacties, bijlagen, locaties en assets. Acceptatie: API-integratietests op echte PostgreSQL, bevoegdheden en conflicten.
3. Planning: privé/gedeelde blokken, herhaling en seizoenen. Acceptatie: privacy, unieke beurten en kalendergrenzen.
4. Voorraad: transactioneel grootboek, transfers, tellingen, idempotentie. Acceptatie: gelijktijdig laatste artikel gebruiken kan geen negatief saldo veroorzaken.
5. Mobiel: Expo iOS/Android, SQLite-wachtrij, cameramedia en QR; expliciete conflictstatus. Acceptatie: typecheck en protocoltests; fysieke apparaten en ondertekende distributie zijn externe releasepoorten.
6. Rapportage en beheer: tijd, notificaties, export/import, optionele AI standaard uit. Acceptatie: rechten, geen stille externe overdracht, werkende exports.
7. Installatie en overdracht: standaard TrueNAS Custom App-interface zonder YAML (aanvullende gebruikersinstructie), CI, back-up/herstel, handleidingen en onafhankelijke review. Acceptatie: één gebundelde image met persistente `/data`, uitvoerbare testresultaten, geen onbewezen productieclaims. Compose dient alleen als ontwikkel/testhulpmiddel.

## Parallel werk en contract

API-basis `/api`; JSON; Bearer access token. Login POST `/auth/login` {email,password} → {token,user}. GET `/auth/me`. UUID IDs, ISO datums, camelCase velden. Lijsten retourneren arrays; fouten {message,...}. PATCH vereist `version`. POST-mutatieretries bevatten `operationId` indien ondersteund. Statussen: open, planned, in_progress, blocked, completed, cancelled, archived; prioriteit low, normal, high, critical. Rollen admin, employee.

Database via `pg`; versiebeheer SQL-migraties. Gedeelde API-infrastructuur in `apps/api/src/db.ts` exporteert `query`, `transaction`, `pool`; auth in `auth.ts` exporteert guard/decorators. Domeinroutes worden gegroepeerd in Nest controllers. Wijzigingen aan contract worden met andere agents afgestemd.

Web en mobiel gebruiken dezelfde API. Native builds vereisen Apple/Google signing en echte apparaten; TrueNAS-acceptatie vereist toegang tot de doelhost. Ontbrekende integraties en beperkingen worden expliciet bijgehouden in het opleverrapport.
