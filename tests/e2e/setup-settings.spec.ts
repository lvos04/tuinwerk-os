import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const setupCode = process.env.E2E_SETUP_CODE;

test.describe("eerste installatie en instellingen op echte API", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !email || !password,
    "Gebruik E2E_EMAIL/E2E_PASSWORD en een geïsoleerde database.",
  );

  const login = async (page: Page) => {
    await page.goto("/");
    await page.getByLabel("E-mailadres", { exact: true }).fill(email!);
    await page.getByLabel("Wachtwoord", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Inloggen", exact: true }).click();
    await expect(page.getByRole("navigation")).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Beheer", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: /^(Instellingen van je werkomgeving|Koppelingen instellen)$/,
      }),
    ).toBeVisible();
  };
  const settingsPanel = (page: Page) =>
    page.locator("section.system-section").filter({
      has: page.getByRole("heading", {
        name: /^(Instellingen van je werkomgeving|Koppelingen instellen)$/,
      }),
    });
  const backupPanel = (page: Page) =>
    page.locator("section.system-section").filter({
      has: page.getByRole("heading", {
        name: "Volledige back-up en herstel",
        exact: true,
      }),
    });

  test("wizard beschermt eerste admin met instelcode en onthoudt serveradres", async ({
    page,
  }) => {
    test.skip(
      !setupCode,
      "Alleen op een lege testdatabase met E2E_SETUP_CODE.",
    );
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Welkom op je eigen werkplek" }),
    ).toBeVisible();
    await page.getByLabel(/Eenmalige installatiecode/).fill(setupCode!);
    await page
      .getByLabel("Bedrijfsnaam", { exact: true })
      .fill("Acceptatietuin");
    await page
      .getByLabel("Je naam", { exact: true })
      .fill("Acceptatie Beheerder");
    await page
      .getByLabel("E-mailadres beheerder", { exact: true })
      .fill(email!);
    await page
      .getByLabel("Wachtwoord", { exact: false })
      .first()
      .fill(password!);
    await page
      .getByLabel("Herhaal wachtwoord", { exact: true })
      .fill("OngelijkTestWachtwoord!");
    await page
      .getByRole("button", { name: "Controleren", exact: true })
      .click();
    await expect(page.locator(".setup-card").getByRole("alert")).toContainText(
      "niet gelijk",
    );
    await page
      .getByLabel("Herhaal wachtwoord", { exact: true })
      .fill(password!);
    await page
      .getByRole("button", { name: "Controleren", exact: true })
      .click();
    await expect(
      page.getByText("Eerste beheerder", { exact: true }),
    ).toBeVisible();
    const completed = page.waitForResponse(
      (r) => r.url().endsWith("/api/setup") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Werkplek aanmaken", exact: true })
      .click();
    expect((await completed).status()).toBe(201);
    await expect(
      page.getByRole("heading", { name: "Aan de slag", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("E-mailadres", { exact: true })).toHaveValue(
      email!,
    );
    await login(page);
    const panel = settingsPanel(page);
    await expect(panel.getByLabel("Bedrijfsnaam", { exact: true })).toHaveValue(
      "Acceptatietuin",
    );
    await expect(panel.getByLabel(/Adres van TuinWerk/)).toHaveValue(
      new URL(page.url()).origin,
    );
    const status = await page.request.get("/api/setup");
    expect(await status.json()).toMatchObject({ required: false });
  });

  test("instellingen blijven opgeslagen en geheimen worden niet teruggegeven", async ({
    page,
  }) => {
    await login(page);
    const panel = settingsPanel(page);
    await panel
      .getByLabel("Bedrijfsnaam", { exact: true })
      .fill("Acceptatietuin opgeslagen");
    await panel
      .getByRole("button", { name: "Instellingen opslaan", exact: true })
      .click();
    await expect(panel.getByRole("status")).toContainText(
      "Instellingen opgeslagen",
    );
    await page.reload();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Beheer", exact: true })
      .click();
    await expect(panel.getByLabel("Bedrijfsnaam", { exact: true })).toHaveValue(
      "Acceptatietuin opgeslagen",
    );
    await page.getByRole("tab", { name: "Integraties", exact: true }).click();
    await panel
      .getByRole("button", { name: "E-mailmeldingen", exact: true })
      .click();
    const secret = "UITestSecret-not-a-real-provider-password-2026";
    await panel.getByLabel(/SMTP-wachtwoord/).fill(secret);
    const save = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/settings") && r.request().method() === "PATCH",
    );
    await panel
      .getByRole("button", { name: "Instellingen opslaan", exact: true })
      .click();
    const result = await (await save).json();
    expect(result.configured.smtpPassword).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
    await expect(panel.getByLabel(/SMTP-wachtwoord/)).toHaveValue("");
    await expect(panel.getByLabel(/SMTP-wachtwoord/)).toHaveAttribute(
      "placeholder",
      /Ingesteld/,
    );
    const preserve = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/settings") && r.request().method() === "PATCH",
    );
    await panel
      .getByRole("button", { name: "Instellingen opslaan", exact: true })
      .click();
    expect((await (await preserve).json()).configured.smtpPassword).toBe(true);
    await panel.getByLabel("Opgeslagen geheim expliciet verwijderen").check();
    const clear = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/settings") && r.request().method() === "PATCH",
    );
    await panel
      .getByRole("button", { name: "Instellingen opslaan", exact: true })
      .click();
    expect((await (await clear).json()).configured.smtpPassword).toBe(false);
  });

  test("herstelsleutel vereist download en bewaarconfirmatie vóór activatie", async ({
    page,
  }) => {
    await login(page);
    await page.getByRole("tab", { name: "Back-ups", exact: true }).click();
    const panel = backupPanel(page);
    const scheduleWasEnabled = await panel
      .getByLabel("Dagelijks een volledige back-up maken")
      .isChecked();
    const keySection = panel.locator("details.backup-key");
    if ((await keySection.getAttribute("open")) === null)
      await keySection.locator("summary").click();
    page.once("dialog", (dialog) => dialog.accept());
    await panel
      .getByRole("button", { name: /^(Nieuwe )?herstelsleutel maken$/i })
      .click();
    const activate = panel.getByRole("button", {
      name: "Deze sleutel activeren",
      exact: true,
    });
    const confirm = panel.getByLabel(
      "Ik heb het herstelbestand buiten deze server opgeslagen.",
    );
    await expect(activate).toBeDisabled();
    await expect(confirm).toBeDisabled();
    const downloading = page.waitForEvent("download");
    await panel
      .getByRole("button", { name: "Herstelbestand downloaden", exact: true })
      .click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("TuinWerk-herstelcode.txt");
    const recovery = await readFile((await download.path())!, "utf8");
    expect(recovery).toContain("Bewaar dit bestand buiten de NAS");
    expect(
      recovery.split("\n").some((line) => /^[A-Za-z0-9_-]{43}$/.test(line)),
    ).toBe(true);
    await expect(activate).toBeDisabled();
    await confirm.check();
    const save = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/backups/config") &&
        r.request().method() === "PUT",
    );
    await activate.click();
    const response = await save;
    expect(response.status()).toBe(200);
    expect((await response.json()).backupPassphraseConfigured).toBe(true);
    await expect(
      panel.getByText("Versleuteling ingesteld.", { exact: false }),
    ).toContainText("Versleuteling ingesteld");
    await expect(
      panel.getByLabel("Dagelijks een volledige back-up maken"),
    ).toBeChecked({ checked: scheduleWasEnabled });
    // Do not start a backup or claim a real restore: this suite verifies the administrator's key workflow.
  });

  test("OneDrive-configuratie bewaart client-id zonder Microsoft-aanmelding te simuleren", async ({
    page,
  }) => {
    await login(page);
    await page.getByRole("tab", { name: "Integraties", exact: true }).click();
    const panel = page.locator("section.system-section").filter({
      has: page.getByRole("heading", {
        name: "OneDrive als externe back-up",
        exact: true,
      }),
    });
    const clientId = "11111111-1111-4111-8111-111111111111";
    await panel.getByLabel(/Microsoft-toepassings-id/).fill(clientId);
    await panel
      .getByRole("combobox", { name: "Soort Microsoft-account", exact: true })
      .selectOption("common");
    await panel
      .getByLabel("Back-upmap binnen de TuinWerk-appmap", { exact: true })
      .fill("UI Acceptatie Backups");
    await panel
      .getByRole("button", { name: "Instellingen opslaan", exact: true })
      .click();
    await expect(panel.getByRole("status")).toContainText("opgeslagen");
    await expect(
      panel.getByText("Niet verbonden", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", {
        name: "Verbinden met Microsoft",
        exact: true,
      }),
    ).toBeEnabled();
    await page.reload();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Beheer", exact: true })
      .click();
    await page.getByRole("tab", { name: "Integraties", exact: true }).click();
    await expect(panel.getByLabel(/Microsoft-toepassings-id/)).toHaveValue(
      clientId,
    );
    await expect(
      panel.getByLabel("Back-upmap binnen de TuinWerk-appmap", { exact: true }),
    ).toHaveValue("UI Acceptatie Backups");
    await panel.locator("summary").click();
    await expect(
      panel.getByText(/Openbare clientstromen toestaan/),
    ).toBeVisible();
    // No fake Microsoft credentials or outbound OAuth calls; actual consent needs the owner's registered app.
  });
});
