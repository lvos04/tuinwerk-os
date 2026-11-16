"use client";
import { F, options, json, type Row } from "../ui";
import type { AdvancedToolsState } from "../use-advanced-tools";

export function TemplatesTab({ w }: { w: AdvancedToolsState }) {
  const {
    selected,
    setSelected,
    rows,
    submit,
    api,
    load,
    setNotice,
    assets,
    busy,
    work,
    reload,
  } = w;
  return (
    <>
      <F label="Sjabloon">
        <select
          value={selected?.id || ""}
          onChange={(e) =>
            setSelected(rows.find((r) => r.id === e.target.value) || null)
          }
        >
          <option value="">Nieuw sjabloon</option>
          {options(rows)}
        </select>
      </F>
      <form
        key={selected?.id || "new"}
        onSubmit={(e) =>
          submit(e, async (f) => {
            const template = {
              ...selected?.template,
              title: f.get("title"),
              description: f.get("description"),
              category: f.get("category"),
              priority: f.get("priority"),
              estimatedMinutes: Number(f.get("minutes") || 0),
              assetId: f.get("assetId") || null,
              checklist: String(f.get("checklist"))
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean)
                .map((text) => ({
                  id: crypto.randomUUID(),
                  text,
                  required: true,
                  done: false,
                })),
            };
            await api(
              selected ? "/templates/" + selected.id : "/templates",
              json(selected ? "PATCH" : "POST", {
                operationId: crypto.randomUUID(),
                version: selected?.version,
                name: f.get("name"),
                template,
              }),
            );
            await load();
            setNotice("Sjabloon opgeslagen.");
          })
        }
      >
        <F label="Sjabloonnaam">
          <input name="name" required defaultValue={selected?.name || ""} />
        </F>
        <F label="Standaardtitel">
          <input
            name="title"
            required
            defaultValue={selected?.template?.title || ""}
          />
        </F>
        <F label="Omschrijving">
          <textarea
            name="description"
            defaultValue={selected?.template?.description || ""}
          />
        </F>
        <div className="form-grid">
          <F label="Categorie">
            <input
              name="category"
              defaultValue={selected?.template?.category || "onderhoud"}
            />
          </F>
          <F label="Geschatte minuten">
            <input
              name="minutes"
              type="number"
              min="0"
              defaultValue={selected?.template?.estimatedMinutes || 0}
            />
          </F>
          <F label="Prioriteit">
            <select
              name="priority"
              defaultValue={selected?.template?.priority || "normal"}
            >
              <option value="low">Laag</option>
              <option value="normal">Normaal</option>
              <option value="high">Hoog</option>
              <option value="critical">Kritiek</option>
            </select>
          </F>
          <F label="Machine">
            <select
              name="assetId"
              defaultValue={selected?.template?.assetId || ""}
            >
              <option value="">Geen vaste machine</option>
              {options(assets)}
            </select>
          </F>
        </div>
        <F label="Verplichte checklist (één punt per regel)">
          <textarea
            name="checklist"
            rows={4}
            defaultValue={
              selected?.template?.checklist
                ?.map((c: Row) => c.text)
                .join("\n") || ""
            }
          />
        </F>
        <button className="primary" disabled={busy}>
          Sjabloon opslaan
        </button>
      </form>
      {selected && (
        <>
          <hr />
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void work(async () => {
                await api(
                  "/templates/" + selected.id + "/apply",
                  json("POST", { operationId: crypto.randomUUID() }),
                );
                await reload();
                setNotice("Nieuwe taak uit het sjabloon aangemaakt.");
              })
            }
          >
            Taak uit dit sjabloon aanmaken
          </button>
        </>
      )}
    </>
  );
}
