"use client";
import { Field, type Row } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function RecurrenceDialog({ w }: { w: WorkspaceView }) {
  const { submit, selected, api, post, setRules, assets, busy } = w;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async (f) => {
          const config: Row = {
            frequency: f.get("frequency"),
            interval: Number(f.get("interval")),
            startDate: f.get("startDate"),
            mode: f.get("mode"),
          };
          if (f.get("endDate")) config.endDate = f.get("endDate");
          if (f.getAll("weekdays").length)
            config.weekdays = f.getAll("weekdays").map(Number);
          if (f.get("nth"))
            config.nthWeekday = {
              nth: Number(f.get("nth")),
              weekday: Number(f.get("weekday")),
            };
          if (f.get("dates"))
            config.dates = String(f.get("dates"))
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
          if (f.get("exceptions"))
            config.exceptions = String(f.get("exceptions"))
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
          const body = {
            title: f.get("title"),
            config,
            taskTemplate: {
              ...selected?.taskTemplate,
              assetId: f.get("assetId") || undefined,
            },
            active: f.get("active") === "on",
          };
          if (selected)
            await api("/recurrences/" + selected.id, {
              method: "PATCH",
              body: JSON.stringify({
                ...body,
                version: selected.version,
              }),
            });
          else await post("/recurrences", body);
          setRules(await api("/recurrences"));
        })
      }
    >
      <Field label="Onderhoudstaak">
        <input name="title" required defaultValue={selected?.title || ""} />
      </Field>
      <div className="form-grid">
        <Field label="Frequentie">
          <select
            name="frequency"
            defaultValue={selected?.config?.frequency || "monthly"}
          >
            <option value="daily">Dagelijks</option>
            <option value="weekly">Wekelijks</option>
            <option value="monthly">Maandelijks</option>
            <option value="yearly">Jaarlijks</option>
            <option value="dates">Expliciete datums</option>
          </select>
        </Field>
        <Field label="Elke N periodes">
          <input
            name="interval"
            type="number"
            min="1"
            defaultValue={selected?.config?.interval || 1}
            required
          />
        </Field>
        <Field label="Eerste datum">
          <input
            name="startDate"
            type="date"
            defaultValue={selected?.config?.startDate || ""}
            required
          />
        </Field>
        <Field label="Einddatum (optioneel)">
          <input
            name="endDate"
            type="date"
            defaultValue={selected?.config?.endDate || ""}
          />
        </Field>
        <Field label="Machine">
          <select
            name="assetId"
            defaultValue={selected?.taskTemplate?.assetId || ""}
          >
            <option value="">Geen machine</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Berekening">
          <select
            name="mode"
            defaultValue={selected?.config?.mode || "calendar"}
          >
            <option value="calendar">Vaste kalender</option>
            <option value="completion">Vanaf laatste uitvoering</option>
          </select>
        </Field>
      </div>
      <Field label="Weekdagen (bij wekelijks)">
        <select
          name="weekdays"
          multiple
          defaultValue={(selected?.config?.weekdays || []).map(String)}
        >
          {[
            "Zondag",
            "Maandag",
            "Dinsdag",
            "Woensdag",
            "Donderdag",
            "Vrijdag",
            "Zaterdag",
          ].map((l, i) => (
            <option key={i} value={i}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="N-de weekdag (bij maandelijks)">
          <select
            name="nth"
            defaultValue={selected?.config?.nthWeekday?.nth || ""}
          >
            <option value="">Vaste kalenderdag</option>
            {[1, 2, 3, 4, 5, -1].map((n) => (
              <option key={n} value={n}>
                {n === -1 ? "Laatste" : n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Weekdag">
          <select
            name="weekday"
            defaultValue={selected?.config?.nthWeekday?.weekday ?? 1}
          >
            {[
              "Zondag",
              "Maandag",
              "Dinsdag",
              "Woensdag",
              "Donderdag",
              "Vrijdag",
              "Zaterdag",
            ].map((l, i) => (
              <option key={i} value={i}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Expliciete datums (YYYY-MM-DD, komma gescheiden)">
        <input
          name="dates"
          defaultValue={selected?.config?.dates?.join(", ") || ""}
        />
      </Field>
      <Field label="Uitzonderingsdatums (komma gescheiden)">
        <input
          name="exceptions"
          defaultValue={selected?.config?.exceptions?.join(", ") || ""}
        />
      </Field>
      <label className="checkbox">
        <input
          name="active"
          type="checkbox"
          defaultChecked={selected?.active ?? true}
        />{" "}
        Onderhoudsregel actief
      </label>
      <p className="muted">
        Wijzigingen gelden voor toekomstige, nog niet gestarte beurten.
        Uitgevoerde historie blijft behouden.
      </p>
      <button className="primary" disabled={busy}>
        Onderhoud opslaan
      </button>
    </form>
  );
}
