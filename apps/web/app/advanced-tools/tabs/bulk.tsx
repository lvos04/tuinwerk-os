"use client";
import { json, F, options } from "../ui";
import type { AdvancedToolsState } from "../use-advanced-tools";

export function BulkTab({ w }: { w: AdvancedToolsState }) {
  const { submit, tasks, api, reload, setNotice, users, busy } = w;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async (f) => {
          const chosen = f.getAll("task");
          if (!chosen.length) throw Error("Selecteer minstens één taak.");
          if (
            !window.confirm(
              `${chosen.length} taken wijzigen? Iedere taak wordt afzonderlijk op conflicten gecontroleerd.`,
            )
          )
            return;
          const failures: string[] = [];
          let done = 0;
          for (const id of chosen) {
            const t = tasks.find((x) => x.id === id)!;
            try {
              await api(
                "/tasks/" + id,
                json("PATCH", {
                  version: t.version,
                  status: f.get("status") || undefined,
                  priority: f.get("priority") || undefined,
                  reason: f.get("reason"),
                  ...(f.get("assign") === "on"
                    ? { assignedTo: f.getAll("assignedTo") }
                    : {}),
                }),
              );
              done++;
            } catch (e) {
              failures.push(t.title + ": " + (e as Error).message);
            }
          }
          await reload();
          setNotice(
            `${done} taken gewijzigd.${failures.length ? " Niet gewijzigd: " + failures.join(" · ") : ""}`,
          );
        })
      }
    >
      <div className="form-grid">
        <F label="Nieuwe status">
          <select name="status">
            <option value="">Ongewijzigd</option>
            {Object.entries({
              open: "Open",
              planned: "Gepland",
              in_progress: "Bezig",
              blocked: "Geblokkeerd",
              completed: "Afgerond",
              cancelled: "Geannuleerd",
              archived: "Gearchiveerd",
            }).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </F>
        <F label="Nieuwe prioriteit">
          <select name="priority">
            <option value="">Ongewijzigd</option>
            <option value="low">Laag</option>
            <option value="normal">Normaal</option>
            <option value="high">Hoog</option>
            <option value="critical">Kritiek</option>
          </select>
        </F>
      </div>
      <F label="Reden (voor blokkeren en heropenen)">
        <input name="reason" />
      </F>
      <label className="checkbox">
        <input type="checkbox" name="assign" /> Toewijzing vervangen door
        onderstaande medewerkers
      </label>
      <F label="Medewerkers">
        <select name="assignedTo" multiple>
          {options(users)}
        </select>
      </F>
      <div style={{ maxHeight: 250, overflow: "auto" }}>
        {tasks
          .filter((t) => t.status !== "archived")
          .map((t) => (
            <label className="checkbox" key={t.id}>
              <input type="checkbox" name="task" value={t.id} />
              {t.title}
            </label>
          ))}
      </div>
      <button className="primary" disabled={busy}>
        Geselecteerde taken wijzigen
      </button>
    </form>
  );
}
