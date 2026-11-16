"use client";
import { json, F } from "../ui";
import type { AdvancedToolsState } from "../use-advanced-tools";

export function AdminTab({ w }: { w: AdvancedToolsState }) {
  const { busy, work, download, submit, api, reload, setNotice } = w;
  return (
    <>
      <h3>Volledige gegevensexport</h3>
      <p className="muted">
        Download de databasegegevens als JSON. Bijlagen en serverconfiguratie
        worden apart via de back-up-/herstelprocedure meegenomen.
      </p>
      <button
        className="primary"
        disabled={busy}
        onClick={() =>
          void work(() => download("/admin/export", "tuinwerk-gegevens.json"))
        }
      >
        Gegevensexport downloaden
      </button>
      <hr />
      <h3>Definitief verwijderen</h3>
      <p className="muted">
        Alleen gearchiveerde gegevens zonder historische verwijzingen kunnen
        worden verwijderd. De server controleert dit en registreert de reden.
      </p>
      <form
        onSubmit={(e) =>
          submit(e, async (f) => {
            if (
              !window.confirm(
                "Dit verwijdert het opgegeven gearchiveerde record definitief. Doorgaan?",
              )
            )
              return;
            await api(
              "/admin/data/" + f.get("type") + "/" + f.get("id"),
              json("DELETE", {
                confirm: f.get("confirm"),
                reason: f.get("reason"),
              }),
            );
            await reload();
            setNotice("Record definitief verwijderd.");
          })
        }
      >
        <F label="Type">
          <select name="type">
            <option value="task">Taak</option>
            <option value="asset">Machine</option>
            <option value="location">Locatie</option>
            <option value="item">Artikel</option>
          </select>
        </F>
        <F label="Record-ID">
          <input name="id" required />
        </F>
        <F label="Herhaal record-ID ter bevestiging">
          <input name="confirm" required />
        </F>
        <F label="Reden">
          <textarea name="reason" required />
        </F>
        <button className="secondary" disabled={busy}>
          Definitief verwijderen
        </button>
      </form>
    </>
  );
}
