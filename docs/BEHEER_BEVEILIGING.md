# Beheer en beveiliging

Gebruik uitsluitend persoonlijke accounts. Medewerkers mogen samenwerken aan taken, machines, locaties en voorraad; accounts en systeeminstellingen blijven beheerderswerk. Intrekbare sessies moeten na verlies van een telefoon direct worden beëindigd. Archiveren is de standaard voor historische gegevens.

De API is de autorisatiegrens. Verberg niet alleen knoppen: controleer rollen, privéplanning, bijlage-download en exportrechten op de server. Gebruik TLS, VPN als externe-toegangsdefault, sterke wachtwoorden en regelmatige beveiligingsupdates. Database is uitsluitend intern bereikbaar. Uploads zijn private bestanden via gecontroleerde API-download, nooit een openbaar uitvoerbaar pad.

Controleer vóór release: geen `.env`/tokens in Git, geen standaardaccounts, login-ratebegrenzing, verlopen/ingetrokken sessies, ongeldige en te grote uploads, path traversal, UUID-verwijzingen, medewerker die beheer probeert en gelijktijdige voorraadmutaties. Run `npm audit` en beoordeel kwetsbaarheden inhoudelijk; upgrade niet blind over breaking changes.

Stel bewaartermijnen en externe back-upretentie vast met de eigenaar. Wis gegevens niet zonder historische gevolgen te controleren. De huidige broncode en opleverstatus bepalen welke beheeracties daadwerkelijk ondersteund zijn. Tweede factor, malware-scanning, push en mail mogen niet als actief worden beschouwd zonder configuratie en concrete tests.

Externe AI is standaard uitgeschakeld. Inschakelen vereist providerconfiguratie, secrets buiten Git, expliciete toestemming per verzending en een beheerd budget. Gebruik geen externe diensten om bedrijfsdata te testen zonder toestemming. Push/mail/distributie hebben afzonderlijke account- en credentialvereisten.

Een nieuwe server vereist image-/broncodeversie, vastgelegde Custom App-invulvelden, secrets uit de kluis, versleuteld database/bestandenarchief en de externe decryptiesleutel. Volg BACKUP_HERSTEL.md en verander daarna DNS of configureerbare mobiele basis-URL. Houd oude server in alleen-lezen/stilgelegde staat om dubbele schrijvers te voorkomen.
