import { test, expect, type Page } from "@playwright/test";
const email = process.env.E2E_EMAIL,
  password = process.env.E2E_PASSWORD;
test.skip(!email || !password, "Geïsoleerde acceptatie-installatie vereist.");
async function login(page: Page, mail = email!, pw = password!, path = "/") {
  await page.goto(path);
  await page.getByLabel("E-mailadres", { exact: true }).fill(mail);
  await page.getByLabel("Wachtwoord", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
}
async function api(page: Page, path: string, body?: unknown, method = "POST") {
  return page.evaluate(
    async ({ path, body, method }) => {
      const r = await fetch("/api" + path, {
        method: body === undefined ? "GET" : method,
        headers: {
          Authorization: "Bearer " + sessionStorage.getItem("tuinwerk-token"),
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw Error(JSON.stringify(result));
      return result;
    },
    { path, body, method },
  );
}
test("beheer heeft aparte onderdelen en eerlijke integratietests op mobiel", async ({
  page,
}, testInfo) => {
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Beheer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Instellingen van je werkomgeving" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Medewerkers", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Je team", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Integraties", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Koppelingen echt controleren" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("integrations-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Back-ups", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Volledige back-up en herstel",
      exact: true,
    }),
  ).toBeVisible();
});
test("favoriet blijft bewaard en vult een taak met de gekozen machine", async ({
  page,
}) => {
  await login(page);
  const asset = await api(page, "/assets", {
    name: "Favoriete pomp " + Date.now(),
    type: "machine",
  });
  await page.reload();
  await page.getByRole("button", { name: "Favorieten beheren" }).click();
  await page.getByLabel("Favoriet kiezen").selectOption(asset.id);
  await page.getByRole("button", { name: "Toevoegen aan favorieten" }).click();
  await expect(
    page.getByRole("button", {
      name: asset.name + " Melding bij machine",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", {
      name: asset.name + " Melding bij machine",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("combobox", { name: "Machine", exact: true }),
  ).toHaveValue(asset.id);
});
test("capaciteit toont overbelasting op basis van echte werkblokken", async ({
  page,
}) => {
  await login(page);
  const me = await api(page, "/auth/me");
  const day = new Date().toISOString().slice(0, 10);
  await api(page, "/schedules", {
    title: "Capaciteitstest",
    userId: me.id,
    startsAt: day + "T09:00:00Z",
    endsAt: day + "T11:00:00Z",
    shared: true,
    participants: [],
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Planning", exact: true })
    .click();
  await page.getByRole("button", { name: "Capaciteit", exact: true }).click();
  await page.getByRole("button", { name: "Mijn beschikbare uren" }).click();
  for (const d of [
    "Zondag",
    "Maandag",
    "Dinsdag",
    "Woensdag",
    "Donderdag",
    "Vrijdag",
    "Zaterdag",
  ])
    await page.getByLabel(d + " (uren)", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Beschikbaarheid opslaan" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Beschikbare uren opgeslagen",
  );
  await expect(page.locator(".capacity-overloaded").first()).toBeVisible();
});
test("medewerker verwijdert eigen account via publieke verwijderlink", async ({
  page,
}) => {
  await login(page);
  const disposable = "delete-" + Date.now() + "@example.test";
  await api(page, "/users", {
    name: "Verwijdertest",
    email: disposable,
    password: "DisposableLocal2026!",
    role: "employee",
  });
  await page.evaluate(() => sessionStorage.clear());
  await login(page, disposable, "DisposableLocal2026!", "/?account=privacy");
  await expect(
    page.getByRole("heading", { name: "Privacy en je account" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mijn account verwijderen", exact: true })
    .click();
  await page
    .getByLabel("Bevestig je huidige wachtwoord")
    .fill("DisposableLocal2026!");
  await page
    .getByLabel("Typ VERWIJDER MIJN ACCOUNT ter bevestiging")
    .fill("VERWIJDER MIJN ACCOUNT");
  await page
    .getByRole("button", {
      name: "Mijn account definitief verwijderen",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Inloggen", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("tuinwerk-token")),
  ).toBeNull();
});
test("privacy en ondersteuning zijn openbaar zonder sessie", async ({
  page,
}) => {
  for (const path of ["/privacy", "/support", "/account-deletion"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
});
test("werkpaneel bewaart checklist en tijd en laat inhoud melden", async ({
  page,
}) => {
  await login(page);
  const title = "Werkpaneel " + Date.now();
  const task = await api(page, "/tasks", {
    title,
    checklist: [
      {
        id: crypto.randomUUID(),
        text: "Veiligheidscontrole",
        required: true,
        done: false,
      },
    ],
  });
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Taken/ })
    .click();
  await page.getByLabel("Taken zoeken").fill(title);
  await page.getByText(title, { exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Gebruikte onderdelen" }),
  ).toBeVisible();
  await dialog.getByLabel(/Veiligheidscontrole/).click();
  await expect(dialog.getByLabel(/Veiligheidscontrole/)).toBeChecked();
  await dialog
    .getByRole("button", { name: "Start / hervat timer", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Pauzeer timer" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Pauzeer timer" }).click();
  await expect(
    dialog.getByRole("button", { name: "Start / hervat timer", exact: true }),
  ).toBeVisible();
  expect((await api(page, "/tasks/" + task.id + "/time")).length).toBe(1);
  await dialog
    .getByRole("button", { name: "Inhoud melden", exact: true })
    .click();
  await dialog
    .getByLabel("Waarom meld je deze inhoud?")
    .fill("Acceptatiecontrole van de meldfunctie");
  await dialog.getByRole("button", { name: "Melding versturen" }).click();
  await expect(
    dialog.getByText("Melding ontvangen. Een beheerder kan deze beoordelen."),
  ).toBeVisible();
});
test("publieke contactgegevens komen uit instellingen en geheime velden blijven weg", async ({
  page,
}) => {
  await login(page);
  const settings = await api(page, "/settings");
  await api(
    page,
    "/settings",
    {
      version: settings.version,
      values: {
        supportEmail: "support-acceptatie@example.test",
        privacyContactEmail: "privacy-acceptatie@example.test",
        privacyRetentionDescription:
          "Acceptatiebeleid: werkregistraties volgen de vastgelegde bewaartermijn.",
      },
    },
    "PATCH",
  );
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/privacy");
  await expect(
    page.getByText("privacy-acceptatie@example.test", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Acceptatiebeleid: werkregistraties volgen de vastgelegde bewaartermijn.",
      { exact: false },
    ),
  ).toBeVisible();
  const info = await page.request.get("/api/public/info");
  const data = await info.json();
  expect(data.privacyContactEmail).toBe("privacy-acceptatie@example.test");
  expect(Object.keys(data).sort()).toEqual(
    [
      "companyName",
      "privacyContactEmail",
      "privacyRetentionDescription",
      "ready",
      "supportEmail",
      "updatedAt",
    ].sort(),
  );
});
test("niet-ingestelde e-mailtest rapporteert echte fout en moderatie toont inhoud", async ({
  page,
}) => {
  await login(page);
  const settings = await api(page, "/settings");
  await api(
    page,
    "/settings",
    { version: settings.version, values: { smtpHost: "" } },
    "PATCH",
  );
  const task = await api(page, "/tasks", {
    title: "Te beoordelen inhoud " + Date.now(),
    description: "Inhoudelijke tekst voor de beoordelaar",
  });
  await api(page, "/moderation/reports", {
    targetType: "task",
    targetId: task.id,
    reason: "Deze inhoud moet inhoudelijk worden beoordeeld",
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Beheer", exact: true })
    .click();
  const section = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Inhoud en meldingen",
        exact: true,
      }),
    })
    .last();
  await expect(section.getByText(task.title, { exact: true })).toBeVisible();
  await expect(
    section
      .getByText("Inhoudelijke tekst voor de beoordelaar", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  const form = section
    .locator("form")
    .filter({ has: page.getByText(task.title, { exact: true }) });
  await form
    .getByLabel("Motivering")
    .fill("Gecontroleerd en geen overtreding vastgesteld");
  await form.getByRole("button", { name: "Besluit vastleggen" }).click();
  await expect(form.getByText(/dismissed/)).toBeVisible();
  await page.getByRole("tab", { name: "Integraties", exact: true }).click();
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/admin/integrations/test/smtp") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Testmail naar mij sturen" }).click();
  const r = await response;
  const result = await r.json();
  expect(r.status()).toBe(400);
  await expect(
    page.getByRole("alert").filter({ hasText: result.message }),
  ).toBeVisible();
});
