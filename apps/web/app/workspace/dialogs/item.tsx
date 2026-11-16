"use client";
import { Field } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function ItemDialog({ w }: { w: WorkspaceView }) {
  const { submit, post, busy } = w;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async (f) => {
          await post("/inventory/items", {
            sku: f.get("sku"),
            name: f.get("name"),
            unit: f.get("unit"),
            minimum: Number(f.get("minimum")),
            description: f.get("description"),
          });
        })
      }
    >
      <Field label="Artikelnaam *">
        <input name="name" required />
      </Field>
      <div className="form-grid">
        <Field label="Artikelnummer *">
          <input name="sku" required />
        </Field>
        <Field label="Eenheid">
          <select name="unit">
            <option>stuk</option>
            <option>meter</option>
            <option>liter</option>
            <option>doos</option>
          </select>
        </Field>
        <Field label="Minimumvoorraad">
          <input
            name="minimum"
            type="number"
            min="0"
            step="any"
            defaultValue="0"
          />
        </Field>
      </div>
      <Field label="Omschrijving">
        <textarea name="description" />
      </Field>
      <button className="primary" disabled={busy}>
        Artikel toevoegen
      </button>
    </form>
  );
}
