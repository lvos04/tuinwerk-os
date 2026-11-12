import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { AuthGuard, AdminGuard, CurrentUser, User } from "./auth";
import { audit, camel, query, transaction } from "./db";
import {
  readSecret,
  refreshRuntimeSettings,
  settingsSnapshot,
} from "./settings";
import { getOneDriveHealth, probeOneDrive } from "./onedrive";
import { sendEmail, sendExpoPush } from "./notification-delivery";

type Kind = "smtp" | "push" | "onedrive";
type TestInput = { confirm?: boolean; deviceId?: string; to?: string };
export type IntegrationTransports = {
  email?: typeof sendEmail;
  push?: typeof sendExpoPush;
  onedrive?: typeof probeOneDrive;
};
function kind(value: string): Kind {
  if (!["smtp", "push", "onedrive"].includes(value))
    throw new BadRequestException("Onbekende integratietest");
  return value as Kind;
}
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function testFingerprint(user: User, testKind: Kind, deviceId?: string) {
  const { values: v } = await settingsSnapshot();
  if (testKind === "smtp")
    return hash({
      host: v.smtpHost,
      port: v.smtpPort,
      secure: v.smtpSecure,
      tls: v.smtpRequireTls,
      user: v.smtpUser,
      from: v.smtpFrom,
      password: hash((await readSecret("smtpPassword")) || ""),
      recipient: user.email,
    });
  if (testKind === "push") {
    const devices = await query(
      "SELECT id,token,active FROM push_devices WHERE user_id=$1 AND active AND ($2::uuid IS NULL OR id=$2) ORDER BY id",
      [user.id, deviceId || null],
    );
    return hash({
      enabled: v.pushEnabled,
      secret: hash((await readSecret("expoAccessToken")) || ""),
      devices,
    });
  }
  const [connection] = await query(
    "SELECT drive_id,connected_at FROM onedrive_connection WHERE id=1",
  );
  return hash({
    clientId: v.oneDriveClientId,
    tenant: v.oneDriveTenantId,
    folder: v.oneDriveFolder,
    connection,
  });
}
async function saveResult(
  user: User,
  testKind: Kind,
  status: "passed" | "failed",
  message: string,
  fingerprint: string,
) {
  return transaction(async (c) => {
    const result = (
      await c.query(
        "INSERT INTO integration_tests(user_id,kind,status,message,config_fingerprint) VALUES($1,$2,$3,$4,$5) RETURNING id,kind,status,message,created_at",
        [user.id, testKind, status, message, fingerprint],
      )
    ).rows[0];
    await audit(c, user.id, "integration", result.id, "test:" + status, {
      kind: testKind,
    });
    return camel(result);
  });
}
/** Invoked only after the administrator explicitly confirms this particular test. */
export async function runIntegrationTest(
  user: User,
  testKind: Kind,
  input: TestInput,
  transports: IntegrationTransports = {},
) {
  if (input.confirm !== true)
    throw new BadRequestException(
      "Bevestig expliciet dat deze test uitgevoerd mag worden",
    );
  if (input.to !== undefined && input.to !== user.email)
    throw new BadRequestException(
      "Testmail kan uitsluitend naar het eigen beheerdersadres",
    );
  if (input.deviceId !== undefined && !/^[0-9a-f-]{36}$/i.test(input.deviceId))
    throw new BadRequestException("Ongeldig apparaat-ID");
  await refreshRuntimeSettings();
  const { values } = await settingsSnapshot();
  const devices =
    testKind === "push"
      ? await query<any>(
          "SELECT id,token,platform FROM push_devices WHERE user_id=$1 AND active AND ($2::uuid IS NULL OR id=$2) ORDER BY id",
          [user.id, input.deviceId || null],
        )
      : [];
  if (testKind === "smtp" && (!values.smtpHost || !values.smtpFrom))
    throw new BadRequestException(
      "Configureer eerst de SMTP-server en het afzenderadres",
    );
  if (testKind === "push" && (!values.pushEnabled || !devices.length))
    throw new BadRequestException(
      "Schakel push in en kies een eigen actief geregistreerd apparaat",
    );
  if (testKind === "onedrive" && !(await getOneDriveHealth()).connected)
    throw new BadRequestException("Verbind eerst OneDrive");
  const fingerprint = await testFingerprint(user, testKind);
  let status: "passed" | "failed" = "passed",
    message = "";
  try {
    if (testKind === "smtp") {
      await (transports.email || sendEmail)(
        user.email,
        "TuinWerk OS — testbericht",
        "Dit testbericht is op jouw verzoek vanuit TuinWerk OS verzonden. Controleer of het bericht in je inbox of spammap staat.",
      );
      message =
        "SMTP-server heeft het bericht voor jouw beheerdersadres geaccepteerd. Controleer zelf de inbox/spammap.";
    } else if (testKind === "push") {
      const notificationId = randomUUID();
      await transaction(async (c) => {
        await c.query(
          "INSERT INTO notifications(id,user_id,kind,title,body) VALUES($1,$2,'integration_test','TuinWerk pushcontrole','Op jouw verzoek verzonden naar jouw apparaat.')",
          [notificationId, user.id],
        );
        // Commit the test event together with suppression of preference-triggered copies.
        await c.query(
          "UPDATE notification_deliveries SET state='skipped' WHERE notification_id=$1",
          [notificationId],
        );
      });
      let accepted = 0,
        invalid = 0;
      for (const device of devices) {
        const result = await (transports.push || sendExpoPush)([device.token], {
          id: notificationId,
          title: "TuinWerk pushcontrole",
          body: "Op jouw verzoek verzonden naar jouw apparaat.",
          kind: "integration_test",
          user_id: user.id,
        });
        for (const token of result.invalidTokens) {
          await query(
            "UPDATE push_devices SET active=false WHERE token=$1 AND user_id=$2",
            [token, user.id],
          );
          invalid++;
        }
        for (const ticket of result.tickets) {
          await query(
            "INSERT INTO push_receipts(id,device_id,notification_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [ticket.id, device.id, notificationId],
          );
          accepted++;
        }
      }
      if (!accepted || invalid)
        throw Error("Niet alle apparaten hebben een geldig ontvangstbewijs");
      message = `Pushprovider accepteerde ${accepted} testmelding(en). Dit bevestigt nog niet dat het apparaat de melding heeft getoond.`;
    } else {
      await (transports.onedrive || probeOneDrive)();
      message =
        "OneDrive-test geslaagd: een klein testbestand is geschreven, teruggelezen en verwijderd.";
    }
  } catch {
    status = "failed";
    message =
      testKind === "smtp"
        ? "SMTP-test mislukt. Controleer server, poort, TLS en de opgeslagen aanmeldgegevens."
        : testKind === "push"
          ? "Push-test niet volledig geslaagd. Controleer de apparaatregistratie, Expo-configuratie en de ontvangst op je eigen apparaat."
          : "OneDrive-test mislukt. Controleer de verbinding, appmapmachtiging en opslagruimte; controleer ook of een tijdelijk tuinwerk-probe-bestand is achtergebleven.";
  }
  if (
    status === "passed" &&
    (await testFingerprint(user, testKind)) !== fingerprint
  ) {
    status = "failed";
    message =
      "De instellingen of apparaten zijn tijdens de test gewijzigd. Controleer de actuele configuratie en voer de test opnieuw uit.";
  }
  return saveResult(user, testKind, status, message, fingerprint);
}

@Controller("admin/integrations")
@UseGuards(AuthGuard, AdminGuard)
export class IntegrationsController {
  @Get("status") async status(@CurrentUser() user: User) {
    const { values, configured } = await settingsSnapshot();
    const health = await getOneDriveHealth();
    const devices = await query<any>(
      "SELECT id,platform,active,created_at FROM push_devices WHERE user_id=$1 AND active ORDER BY created_at DESC",
      [user.id],
    );
    const checks: any[] = [];
    const check = (
      key: string,
      label: string,
      status: string,
      detail: string,
      optional = false,
      lastTest?: unknown,
    ) => checks.push({ key, label, status, detail, optional, lastTest });
    check(
      "company",
      "Bedrijfsnaam",
      values.companyName ? "ready" : "missing",
      values.companyName
        ? "Bedrijfsnaam is ingevuld."
        : "Vul de bedrijfsnaam in.",
    );
    check(
      "server",
      "Adres van de server",
      values.appUrl ? "ready" : "missing",
      values.appUrl
        ? "Serveradres is ingesteld; bereikbaarheid vanaf echte apparaten moet nog worden gecontroleerd."
        : "Vul het serveradres in voor mobiele verbindingen en meldingslinks.",
    );
    const [counts] = await query<any>(
      "SELECT (SELECT count(*) FROM users WHERE active) users,(SELECT count(*) FROM locations WHERE active) locations",
    );
    check(
      "users",
      "Medewerkers",
      Number(counts.users) > 0 ? "ready" : "untested",
      `${counts.users} actief account(s). Voeg medewerkers toe als zij gaan meewerken.`,
    );
    check(
      "locations",
      "Locaties",
      Number(counts.locations) > 0 ? "ready" : "untested",
      `${counts.locations} actieve locatie(s). Richt de gewenste locatiestructuur in.`,
    );
    check(
      "backupKey",
      "Back-upherstelsleutel",
      configured.backupPassphrase ? "ready" : "missing",
      configured.backupPassphrase
        ? "Een sleutel is opgeslagen. Bewaar een eigen kopie buiten de server."
        : "Maak een herstelsleutel en bewaar die apart.",
    );
    const [backup] = await query<any>(
      "SELECT completed_at FROM backup_jobs WHERE operation='backup' AND state='completed' ORDER BY completed_at DESC LIMIT 1",
    );
    check(
      "backup",
      "Lokale back-up",
      backup ? "passed" : "untested",
      backup
        ? "Een lokale back-up is aantoonbaar voltooid."
        : "Voer eerst een echte lokale back-up uit.",
    );
    const [restore] = await query<any>(
      "SELECT operation,completed_at FROM backup_jobs WHERE operation IN ('restore_preview','restore') AND state='completed' ORDER BY completed_at DESC LIMIT 1",
    );
    check(
      "restore",
      "Herstelcontrole",
      restore?.operation === "restore" ? "passed" : "untested",
      restore
        ? restore.operation === "restore"
          ? "Een herstelactie is voltooid; controleer de herstelde gegevens."
          : "Een archief is technisch gecontroleerd. Dit is nog geen volledige herstelproef."
        : "Controleer een archief met de herstelvoorvertoning; test herstel op een aparte installatie.",
    );
    for (const testKind of ["smtp", "push", "onedrive"] as const) {
      const isConfigured =
        testKind === "smtp"
          ? !!(values.smtpHost && values.smtpFrom)
          : testKind === "push"
            ? !!values.pushEnabled && devices.length > 0
            : health.connected;
      const fingerprint = await testFingerprint(user, testKind);
      const [last] = await query<any>(
        "SELECT id,kind,status,message,created_at,config_fingerprint FROM integration_tests WHERE user_id=$1 AND kind=$2 ORDER BY created_at DESC LIMIT 1",
        [user.id, testKind],
      );
      const matching = last?.config_fingerprint === fingerprint;
      const lastTest = last
        ? camel({
            id: last.id,
            status: last.status,
            message: last.message,
            created_at: last.created_at,
            configurationCurrent: matching,
          })
        : undefined;
      const label = {
        smtp: "E-mail",
        push: "Pushmeldingen",
        onedrive: "OneDrive",
      }[testKind];
      check(
        testKind,
        label,
        !isConfigured
          ? "missing"
          : testKind === "onedrive" && health.reauthenticationRequired
            ? "failed"
            : matching
              ? last.status
              : "untested",
        !isConfigured
          ? `${label} is niet aangesloten of nog niet volledig ingesteld.`
          : testKind === "onedrive" && health.lastError
            ? health.lastError.message
            : matching
              ? last.message
              : "Configuratie aanwezig; voer de expliciete verbindingstest uit.",
        testKind !== "onedrive" || !values.backupOneDriveEnabled,
        lastTest,
      );
    }
    check(
      "ai",
      "Optionele AI",
      values.aiEnabled
        ? configured.aiApiKey &&
          values.aiBaseUrl &&
          values.aiModel &&
          Number(values.aiDailyBudgetEur) > 0 &&
          Number(values.aiInputEurPerMillion) > 0 &&
          Number(values.aiOutputEurPerMillion) > 0
          ? "ready"
          : "missing"
        : "ready",
      values.aiEnabled
        ? "AI is ingeschakeld; providergebruik wordt hier niet automatisch getest."
        : "AI staat uit. Dit blokkeert het dagelijks gebruik niet.",
      true,
    );
    return {
      checks,
      devices: devices.map(camel),
      recipient: user.email,
      oneDriveHealth: health,
    };
  }
  @Post("test/:kind") test(
    @CurrentUser() user: User,
    @Param("kind") value: string,
    @Body() input: TestInput,
  ) {
    return runIntegrationTest(user, kind(value), input);
  }
}
