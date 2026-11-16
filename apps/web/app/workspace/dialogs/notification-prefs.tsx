"use client";
import { Field } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function NotificationPrefsDialog({ w }: { w: WorkspaceView }) {
  const { submit, api, prefs, busy } = w;
  if (!prefs) return null;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async (f) => {
          await api("/notifications/preferences", {
            method: "PUT",
            body: JSON.stringify({
              inApp: f.get("inApp") === "on",
              push: f.get("push") === "on",
              email: f.get("email") === "on",
              criticalOverride: f.get("criticalOverride") === "on",
              weekly: f.get("weekly") === "on",
              digestMinutes: Number(f.get("digestMinutes") || 0),
              quietStart: f.get("quietStart") || null,
              quietEnd: f.get("quietEnd") || null,
            }),
          });
        })
      }
    >
      {[
        ["inApp", "In-app meldingen"],
        ["push", "Push naar geregistreerde apparaten"],
        ["email", "E-mailmeldingen"],
        ["weekly", "Wekelijks werkoverzicht"],
        ["criticalOverride", "Kritieke meldingen ook tijdens stille uren"],
      ].map(([k, l]) => (
        <label className="checkbox" key={k}>
          <input type="checkbox" name={k} defaultChecked={prefs[k]} />
          {l}
        </label>
      ))}
      <div className="form-grid">
        <Field label="Stille uren vanaf">
          <input
            type="time"
            name="quietStart"
            defaultValue={prefs.quietStart || ""}
          />
        </Field>
        <Field label="Tot">
          <input
            type="time"
            name="quietEnd"
            defaultValue={prefs.quietEnd || ""}
          />
        </Field>
      </div>
      <Field label="Normale meldingen bundelen (minuten)">
        <input
          name="digestMinutes"
          type="number"
          min="0"
          max="60"
          defaultValue={prefs.digestMinutes ?? 5}
        />
        <small>
          0 verstuurt direct. Kritieke uitzonderingen en stille uren blijven
          gelden.
        </small>
      </Field>
      <p className="muted">
        Push en e-mail werken wanneer de beheerder het bijbehorende transport
        heeft ingesteld.
      </p>
      <button className="primary" disabled={busy}>
        Voorkeuren opslaan
      </button>
    </form>
  );
}
