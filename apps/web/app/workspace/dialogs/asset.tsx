"use client";
import { Field, type Row } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function AssetDialog({ w }: { w: WorkspaceView }) {
  const { submit, dialog, selected, api, post, locations, busy } = w;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async (f) => {
          const body: Row = { name: f.get("name") };
          if (dialog === "asset") {
            Object.assign(body, {
              manufacturer: f.get("manufacturer"),
              model: f.get("model"),
              serialNumber: f.get("serialNumber"),
              locationId: f.get("locationId") || null,
              status: f.get("status") || "active",
            });
            if (selected)
              await api("/assets/" + selected.id, {
                method: "PATCH",
                body: JSON.stringify({
                  ...body,
                  version: selected.version,
                }),
              });
            else await post("/assets", body);
          } else {
            Object.assign(body, {
              parentId: f.get("parentId") || null,
              type: f.get("type"),
              active: f.get("active") === "on",
            });
            if (selected)
              await api("/locations/" + selected.id, {
                method: "PATCH",
                body: JSON.stringify({
                  ...body,
                  version: selected.version,
                }),
              });
            else await post("/locations", body);
          }
        })
      }
    >
      <Field label="Naam *">
        <input name="name" required defaultValue={selected?.name || ""} />
      </Field>
      {dialog === "asset" ? (
        <>
          <div className="form-grid">
            <Field label="Fabrikant">
              <input
                name="manufacturer"
                defaultValue={selected?.manufacturer || ""}
              />
            </Field>
            <Field label="Model">
              <input name="model" defaultValue={selected?.model || ""} />
            </Field>
          </div>
          <Field label="Status">
            <select name="status" defaultValue={selected?.status || "active"}>
              <option value="active">Actief</option>
              <option value="out_of_service">Buiten bedrijf</option>
              <option value="archived">Gearchiveerd</option>
            </select>
          </Field>
          <Field label="Serienummer">
            <input
              name="serialNumber"
              defaultValue={selected?.serialNumber || ""}
            />
          </Field>
          <Field label="Locatie">
            <select name="locationId" defaultValue={selected?.locationId || ""}>
              <option value="">Geen locatie</option>
              {locations
                .filter((l) => l.active !== false)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </Field>
        </>
      ) : (
        <>
          <Field label="Bovenliggende locatie">
            <select name="parentId" defaultValue={selected?.parentId || ""}>
              <option value="">Hoofdlocatie</option>
              {locations
                .filter((l) => l.active !== false && l.id !== selected?.id)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </Field>
          <label className="checkbox">
            <input
              name="active"
              type="checkbox"
              defaultChecked={selected?.active !== false}
            />{" "}
            Actieve locatie
          </label>
          <Field label="Type">
            <input
              name="type"
              defaultValue={selected?.type || ""}
              placeholder="Kas, magazijn, stelling…"
            />
          </Field>
        </>
      )}
      <button className="primary" disabled={busy}>
        Opslaan
      </button>
    </form>
  );
}
