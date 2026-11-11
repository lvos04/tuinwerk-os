# Back-up en herstel via de Custom App

Gebruik de **Shell**-functie van de geïnstalleerde TuinWerk Custom App. Geen YAML en geen Compose-opdrachten nodig.

## Versleutelde back-up

Maak vooraf buiten de NAS een `age`-sleutelpaar. Bewaar de private sleutel in een aparte wachtwoordkluis/herstelmedium. Zet uitsluitend de publieke ontvanger als `AGE_RECIPIENT` bij de Custom App-omgevingsvariabelen.

Voer in de app-shell uit:

```sh
/opt/tuinwerk/backup.sh
```

Het script pauzeert API, web en worker kort, maakt een consistente PostgreSQL-dump en bestandstar met foto's/exports, legt checksums vast en versleutelt het archief. Het start de diensten ook na een fout opnieuw. Het resultaat staat in `/data/backups/tuinwerk-...tar.age`. Er is geen plaintext databasearchief dat na succesvolle afronding achterblijft. Alleen een publiek encryptiesleuteldeel staat op de server. Appconfiguratie/secrets worden afzonderlijk in de kluis bewaard, inclusief `TOTP_ENCRYPTION_KEY` als 2FA actief is. Herstel die sleutel ongewijzigd: zonder sleutel zijn bestaande 2FA-geheimen onleesbaar.

Wanneer `AGE_RECIPIENT` ingesteld is, voert de ingebouwde back-upservice dagelijks automatisch een back-up uit (eerste poging 60 seconden na opstart). `BACKUP_INTERVAL_SECONDS` is instelbaar, standaard 86400 en minimaal 3600. Controleer de logs en `/data/status/last-backup-success`/`last-backup-failure`; zonder ontvanger blijft de automatische back-up uitgeschakeld. Test de eerste archieven op herstelbaarheid. Combineer met geplande ZFS-snapshots en een externe versievaste kopie. Gebruik bijvoorbeeld TrueNAS Cloud Sync naar OneDrive uitsluitend voor de map met versleutelde archieven, of een afzonderlijk beheerde rclone-taak. Standaard wordt niets automatisch verwijderd. Configureer de optionele bewaartermijn zoals hieronder; de aanbevolen selectie is 30 dagelijkse en 12 maandelijkse herstelpunten. Synchroniseren alleen is geen retentiebeleid. Een snapshot op dezelfde NAS beschermt niet tegen verlies van de NAS.

## Herstelproef

1. Maak een **nieuwe** lege dataset en een tweede Custom App met dezelfde image-tag en een andere hostpoort. Laat die initialiseren; gebruik nooit de bestaande productieapp als herstelproef.
2. Plaats het vertrouwde versleutelde archief in de nieuwe `backups`-datasetmap. Mount de private age-sleutel tijdelijk read-only als `/run/restore-key` via de standaard storagevelden. Verwijder deze mount na herstel.
3. Voer in de shell van de **nieuwe herstelapp** uit:

   ```sh
   export AGE_IDENTITY=/run/restore-key
   export RESTORE_CONFIRM=REPLACE_THIS_INSTALLATION
   /opt/tuinwerk/restore.sh /data/backups/tuinwerk-uwarchief.tar.age
   ```

   Dit vervangt expliciet de bootstrapdatabase en bijlagen van deze herstelapp. Checksums worden eerst geverifieerd. Bij een gedeeltelijke fout blijven de appdiensten gestopt; herstel opnieuw op een verse testdataset.
4. Controleer accountlogin, aantallen taken, taakgeschiedenis, foto-inhoud/hashes, planningrechten, voorraadsaldi, mutaties en twee onderhoudsruns zonder duplicaat. Test een telefoon tegen deze tijdelijke URL.
5. Noteer archieftijd, image-tag, start/eindtijd, aantallen en resultaat. Dit bepaalt werkelijk gemeten RTO. RPO is de tijd sinds de laatste bruikbare back-up; bij dagelijks back-uppen mogelijk circa 24 uur.
6. Verwijder private-sleutelmount en shellvariabelen. Schakel pas na acceptatie de productie-URL om en houd de oude app gestopt zodat er geen twee schrijvers ontstaan.

De ontwikkelscripts in `scripts/` voor Compose zijn uitsluitend voor testomgevingen; de bovenstaande containercommando's zijn de gebruikersroute.

## Configureerbare retentie

Bekijk eerst zonder verwijderingen in de app-shell:

```sh
python3 /opt/tuinwerk/retention.py /data/backups --daily 30 --monthly 12
```

De selectie houdt het nieuwste geldige archief per dag voor de laatste 30 verschillende dagen en per maand voor de laatste 12 verschillende maanden. Een archief kan beide rollen vervullen. Onbekende bestanden, ongeldige datumnamen, symlinks en onvoltooide `.partial`-bestanden worden nooit verwijderd. Er moet minimaal één dag en één maand worden bewaard.

Pas na een geslaagde herstelproef en controle van de dry-run kan de beheerder via de Custom App-omgevingsvelden `BACKUP_RETENTION_APPLY=true`, `BACKUP_KEEP_DAILY=30` en `BACKUP_KEEP_MONTHLY=12` instellen. Opruiming loopt daarna alleen na een geslaagde nieuwe back-up, onder dezelfde lock. Deze instelling verwijdert oudere lokale archieven volgens de getoonde selectie; externe bewaring blijft afzonderlijk te beheren. Handmatig toepassen kan met hetzelfde commando plus `--apply`.

## Externe OneDrive-kopie

Gebruik de standaard TrueNAS **Cloud Sync Task** met een apart geconfigureerde Microsoft OneDrive-credential, richting **PUSH**, overdrachtsmodus **COPY**, en alleen de datasetmap `backups` met de versleutelde `*.tar.age`-bestanden. Plan na de back-up. Bewaar de private age-sleutel apart. Configureer externe versie-/retentiebewaring en controleer periodiek een herstel vanaf de externe kopie.

Als u al een aparte beheerhost met rclone gebruikt, is de equivalente optionele route:

```sh
rclone copy /mnt/uwpool/apps/tuinwerk/backups onedrive:tuinwerk-backups --include '*.tar.age'
```

Configureer `onedrive` vooraf via rclone's beveiligde authenticatie op die beheerhost. De app bevat geen Microsoft-credential of fictieve actieve koppeling. Kopiëren verwijdert geen eerdere externe herstelpunten; stel de bewaartermijn bij die bestemming bewust in. Externe verbinding en herstel moeten met het echte account worden getest.
