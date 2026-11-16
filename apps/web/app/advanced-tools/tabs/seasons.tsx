"use client";
import { F, options, json, type Row } from "../ui";
import type { AdvancedToolsState } from "../use-advanced-tools";

export function SeasonsTab({ w }: { w: AdvancedToolsState }) {
  const {
    selected,
    setSelected,
    rows,
    submit,
    api,
    load,
    setNotice,
    busy,
    extra,
    reload,
    users,
  } = w;
  return (
    <>
      <F label="Bestaand seizoenssjabloon">
        <select
          value={selected?.id || ""}
          onChange={(e) =>
            setSelected(rows.find((r) => r.id === e.target.value) || null)
          }
        >
          <option value="">Kies een sjabloon</option>
          {options(rows)}
        </select>
      </F>
      {selected && (
        <form
          key={selected.id}
          onSubmit={(e) =>
            submit(e, async (f) => {
              const activities = String(f.get("activities"))
                .split("\n")
                .filter(Boolean)
                .map((line, index) => {
                  const [offset, ...title] = line.split(";");
                  return {
                    ...selected.activities?.[index],
                    title: title.join(";").trim(),
                    offsetDays: Number(offset),
                  };
                });
              await api(
                "/seasons/" + selected.id,
                json("PATCH", {
                  version: selected.version,
                  name: f.get("name"),
                  activities,
                }),
              );
              await load();
              setNotice("Sjabloon bijgewerkt voor volgende activaties.");
            })
          }
        >
          <F label="Naam">
            <input name="name" required defaultValue={selected.name} />
          </F>
          <F label="Activiteiten: relatieve dag; titel">
            <textarea
              name="activities"
              required
              rows={6}
              defaultValue={selected.activities
                .map((a: Row) => a.offsetDays + "; " + a.title)
                .join("\n")}
            />
          </F>
          <button className="primary" disabled={busy}>
            Sjabloon bijwerken
          </button>
        </form>
      )}
      <hr />
      <h3>Geactiveerde seizoenen verschuiven</h3>
      {extra.map((a) => (
        <form
          key={a.id}
          onSubmit={(e) =>
            submit(e, async (f) => {
              if (
                !window.confirm(
                  "Alle nog niet gestarte activiteiten naar de nieuwe seizoensdatum verplaatsen?",
                )
              )
                return;
              const r = await api(
                "/seasons/activations/" + a.id + "/shift",
                json("POST", {
                  version: a.version,
                  date: f.get("date"),
                  ...(f.get("reassign") === "on"
                    ? { assigneeIds: f.getAll("assigneeIds") }
                    : {}),
                }),
              );
              await load();
              await reload();
              setNotice(
                `${r.shifted.length} taken verplaatst; ${r.skipped.length} gestarte/uitgevoerde taken behouden.`,
              );
            })
          }
        >
          <h3>{a.name}</h3>
          <F label="Nieuwe gebeurtenisdatum">
            <input
              type="date"
              name="date"
              required
              defaultValue={String(a.anchorDate).slice(0, 10)}
            />
          </F>
          <label className="checkbox">
            <input name="reassign" type="checkbox" /> Betrokken medewerkers
            vervangen
          </label>
          <F label="Medewerkers">
            <select name="assigneeIds" multiple>
              {options(users)}
            </select>
          </F>
          <button className="secondary" disabled={busy}>
            Seizoen verschuiven
          </button>
          <hr />
        </form>
      ))}
    </>
  );
}
