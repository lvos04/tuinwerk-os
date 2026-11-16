"use client";
import { F, options, json } from "../ui";
import type { AdvancedToolsState } from "../use-advanced-tools";

export function ItemsTab({ w }: { w: AdvancedToolsState }) {
  const {
    selected,
    setSelected,
    items,
    submit,
    api,
    reload,
    setNotice,
    assets,
    busy,
  } = w;
  return (
    <>
      <F label="Artikel bewerken">
        <select
          value={selected?.id || ""}
          onChange={(e) =>
            setSelected(items.find((r) => r.id === e.target.value) || null)
          }
        >
          <option value="">Kies een artikel</option>
          {options(items)}
        </select>
      </F>
      {selected && (
        <form
          key={selected.id}
          onSubmit={(e) =>
            submit(e, async (f) => {
              await api(
                "/inventory/items/" + selected.id,
                json("PATCH", {
                  version: selected.version,
                  name: f.get("name"),
                  sku: f.get("sku"),
                  unit: f.get("unit"),
                  minimum: Number(f.get("minimum")),
                  price: f.get("price") ? Number(f.get("price")) : null,
                  supplier: f.get("supplier"),
                  supplierSku: f.get("supplierSku"),
                  description: f.get("description"),
                  category: f.get("category"),
                  compatibleAssetIds: f.getAll("compatibleAssetIds"),
                  active: f.get("active") === "on",
                }),
              );
              setSelected(null);
              await reload();
              setNotice("Artikel bijgewerkt.");
            })
          }
        >
          <F label="Artikelnaam">
            <input name="name" required defaultValue={selected.name} />
          </F>
          <div className="form-grid">
            <F label="Artikelnummer">
              <input name="sku" required defaultValue={selected.sku} />
            </F>
            <F label="Eenheid">
              <input name="unit" required defaultValue={selected.unit} />
            </F>
            <F label="Minimum totaal">
              <input
                type="number"
                min="0"
                step="any"
                name="minimum"
                defaultValue={selected.minimum}
              />
            </F>
            <F label="Prijsindicatie per eenheid">
              <input
                type="number"
                min="0"
                step="any"
                name="price"
                defaultValue={selected.price || ""}
              />
            </F>
            <F label="Leverancier (referentie)">
              <input name="supplier" defaultValue={selected.supplier} />
            </F>
            <F label="Artikelnummer leverancier">
              <input name="supplierSku" defaultValue={selected.supplierSku} />
            </F>
          </div>
          <F label="Categorie">
            <input name="category" defaultValue={selected.category} />
          </F>
          <F label="Omschrijving">
            <textarea name="description" defaultValue={selected.description} />
          </F>
          <F label="Compatibele machines">
            <select
              name="compatibleAssetIds"
              multiple
              defaultValue={selected.compatibleAssetIds || []}
            >
              {options(assets)}
            </select>
          </F>
          <label className="checkbox">
            <input
              name="active"
              type="checkbox"
              defaultChecked={selected.active}
            />{" "}
            Actief in catalogus
          </label>
          <button className="primary" disabled={busy}>
            Artikel opslaan
          </button>
        </form>
      )}
    </>
  );
}
