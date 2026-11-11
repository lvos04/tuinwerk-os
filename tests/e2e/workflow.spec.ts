import { test, expect } from "@playwright/test";
const email = process.env.E2E_EMAIL,
  password = process.env.E2E_PASSWORD;
test.skip(
  !email || !password,
  "Set E2E_EMAIL/E2E_PASSWORD for an isolated test installation",
);
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("E-mailadres").fill(email!);
  await page.getByLabel("Wachtwoord", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Inloggen", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Overzicht", exact: true }),
  ).toBeVisible();
});
test("storing, verplichte checklist, afronden en heropenen", async ({
  page,
}) => {
  const title = "Browseracceptatie " + Date.now();
  await page.getByRole("button", { name: "Nieuwe taak", exact: true }).click();
  await page.getByLabel("Wat moet er gebeuren?").fill(title);
  await page
    .getByLabel("Omschrijving", { exact: true })
    .fill("Lekkende koppeling inspecteren");
  await page
    .getByRole("button", { name: "Taak aanmaken", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page
    .getByRole("button", { name: /^Taken/ })
    .first()
    .click();
  await page.getByLabel("Taken zoeken").fill(title);
  await page.getByText(title, { exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Checklist", exact: true }).click();
  await page.getByLabel("Checklistpunt").fill("Druktest uitvoeren");
  await page.getByLabel("Verplicht", { exact: true }).check();
  await dialog.getByRole("button", { name: "Toevoegen", exact: true }).click();
  await expect(dialog.getByText("Druktest uitvoeren")).toBeVisible();
  await dialog.getByRole("button", { name: "Details", exact: true }).click();
  await dialog
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("completed");
  await dialog.getByRole("button", { name: "Wijzigingen opslaan" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Verplichte checklist");
  await dialog.getByRole("button", { name: "Checklist", exact: true }).click();
  await dialog.getByLabel(/Druktest uitvoeren/).click();
  await expect(dialog.getByLabel(/Druktest uitvoeren/)).toBeChecked();
  await dialog.getByRole("button", { name: "Details", exact: true }).click();
  await dialog
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("completed");
  await dialog.getByRole("button", { name: "Wijzigingen opslaan" }).click();
  await expect(dialog.locator(".badge.completed")).toHaveText("Afgerond");
  await dialog
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("open");
  await page
    .getByLabel("Reden (verplicht bij blokkeren en heropenen)")
    .fill("Controle opnieuw uitvoeren");
  await dialog.getByRole("button", { name: "Wijzigingen opslaan" }).click();
  await expect(dialog.locator(".badge.open")).toHaveText("Open");
});
test("alle hoofdschermen laden en responsive navigatie", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const name of [
    "Planning",
    "Machines",
    "Locaties",
    "Voorraad",
    "Rapportages",
    "Beheer",
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name, exact: true }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Taken/ })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Taken", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
test("voorraad via schermen boeken en onvoldoende saldo afwijzen", async ({
  page,
}) => {
  const suffix = String(Date.now()),
    location = "Magazijn " + suffix,
    item = "Pakking " + suffix;
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Locaties", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Locatie toevoegen", exact: true })
    .click();
  await page.getByLabel("Naam *", { exact: true }).fill(location);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Opslaan", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Voorraad", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Artikel toevoegen", exact: true })
    .click();
  await page.getByLabel("Artikelnaam *").fill(item);
  await page.getByLabel("Artikelnummer *").fill("E2E-" + suffix);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Artikel toevoegen", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByText(item, { exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Voorraad boeken", exact: true })
    .click();
  let d = page.getByRole("dialog");
  await d
    .getByRole("combobox", { name: "Mutatie", exact: true })
    .selectOption("receipt");
  await d
    .getByRole("combobox", { name: "Opslaglocatie", exact: true })
    .selectOption({ label: location });
  await d.getByLabel("Aantal", { exact: true }).fill("1");
  await d.getByLabel("Reden / toelichting").fill("Ontvangst test");
  await d.getByRole("button", { name: "Mutatie bevestigen" }).click();
  await expect(d).toBeHidden();
  await page.getByText(item, { exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Voorraad boeken", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d
    .getByRole("combobox", { name: "Mutatie", exact: true })
    .selectOption("usage");
  await d
    .getByRole("combobox", { name: "Opslaglocatie", exact: true })
    .selectOption({ label: location });
  await d.getByLabel("Aantal", { exact: true }).fill("2");
  await d.getByLabel("Reden / toelichting").fill("Te veel verbruik");
  await d.getByRole("button", { name: "Mutatie bevestigen" }).click();
  await expect(d.getByRole("alert")).toContainText("Conflict");
  await expect(d.getByLabel("Aantal", { exact: true })).toHaveValue("2");
  await d.getByLabel("Aantal", { exact: true }).fill("1");
  await d.getByRole("button", { name: "Mutatie bevestigen" }).click();
  await expect(d).toBeHidden();
});

test("sjabloon toepassen en volledige jaarprognose bekijken", async ({
  page,
}) => {
  const suffix = String(Date.now()),
    name = "Inspectie " + suffix;
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Taken/ })
    .click();
  await page
    .getByRole("button", { name: "Sjablonen, bulk wijzigen en AI" })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Sjabloonnaam", { exact: true }).fill(name);
  await d.getByLabel("Standaardtitel", { exact: true }).fill(name);
  await d
    .getByLabel("Verplichte checklist (één punt per regel)")
    .fill("Lekkage controleren");
  await d
    .getByRole("button", { name: "Sjabloon opslaan", exact: true })
    .click();
  await expect(
    d.getByText("Sjabloon opgeslagen.", { exact: true }),
  ).toBeVisible();
  await d
    .getByRole("combobox", { name: "Sjabloon", exact: true })
    .selectOption({ label: name });
  await d
    .getByRole("button", { name: "Taak uit dit sjabloon aanmaken" })
    .click();
  await expect(
    d.getByText("Nieuwe taak uit het sjabloon aangemaakt.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dialoog sluiten" }).click();
  await page.getByLabel("Taken zoeken").fill(name);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Planning", exact: true })
    .click();
  await page.getByRole("button", { name: "Jaarplanning", exact: true }).click();
  await expect(page.getByText("januari", { exact: true })).toBeVisible();
  await expect(page.getByText("december", { exact: true })).toBeVisible();
});
