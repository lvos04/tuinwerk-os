"use client";
/**
 * Herbevestiging voor gevoelige acties (back-up terugzetten, volledige export,
 * koppelsleutel aanmaken) wanneer de beheerder die instelling heeft aangezet.
 * Toont een klein modaal venster en geeft de ingevoerde gegevens terug, of null
 * bij annuleren.
 */
export function askReauth(
  method: "otp" | "password",
): Promise<{ otp: string } | { password: string } | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal reauth-dialog";
    dialog.setAttribute("aria-labelledby", "reauth-title");
    const form = document.createElement("form");
    form.method = "dialog";
    form.style.display = "grid";
    form.style.gap = "12px";
    form.style.padding = "20px";
    const title = document.createElement("h2");
    title.id = "reauth-title";
    title.textContent = "Bevestig deze actie";
    const text = document.createElement("p");
    text.className = "muted";
    text.textContent =
      method === "otp"
        ? "Vul de code uit je authenticator-app (of een herstelcode) in. De bevestiging geldt 5 minuten."
        : "Vul je wachtwoord opnieuw in. De bevestiging geldt 5 minuten.";
    const label = document.createElement("label");
    label.className = "field";
    const span = document.createElement("span");
    span.textContent = method === "otp" ? "Authenticatorcode" : "Wachtwoord";
    const input = document.createElement("input");
    input.type = method === "otp" ? "text" : "password";
    input.required = true;
    input.autocomplete =
      method === "otp" ? "one-time-code" : "current-password";
    if (method === "otp") input.inputMode = "numeric";
    label.append(span, input);
    const actions = document.createElement("div");
    actions.className = "toolbar";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = "Annuleren";
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.className = "primary";
    ok.textContent = "Bevestigen";
    actions.append(cancel, ok);
    form.append(title, text, label, actions);
    dialog.append(form);
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      dialog.close();
      dialog.remove();
      resolve(
        value === null
          ? null
          : method === "otp"
            ? { otp: value }
            : { password: value },
      );
    };
    cancel.onclick = () => finish(null);
    dialog.addEventListener("cancel", () => finish(null));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      finish(input.value);
    });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}

/** Leest een 403-antwoord en vraagt zo nodig om herbevestiging. */
export async function reauthFromResponse(
  body: any,
  submit: (credentials: Record<string, string>) => Promise<unknown>,
) {
  if (!body?.reauthRequired) return false;
  const credentials = await askReauth(
    body.method === "otp" ? "otp" : "password",
  );
  if (!credentials)
    throw new Error("Geannuleerd: deze actie vereist een herbevestiging.");
  await submit(credentials);
  return true;
}
