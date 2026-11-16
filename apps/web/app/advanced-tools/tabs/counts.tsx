"use client";
import { F, options, json, type Row } from "../ui";
import type { AdvancedToolsState } from "../use-advanced-tools";

export function CountsTab({ w }: { w: AdvancedToolsState }) {
  const {
    selected,
    work,
    setSelected,
    api,
    rows,
    submit,
    setNotice,
    items,
    locations,
    busy,
  } = w;
  return (
    <>
      <F label="Telronde">
        <select
          value={selected?.id || ""}
          onChange={(e) => {
            const id = e.target.value;
            if (id)
              void work(async () =>
                setSelected(await api("/inventory/counts/" + id)),
              );
            else setSelected(null);
          }}
        >
          <option value="">Kies een telronde</option>
          {options(rows)}
        </select>
      </F>
      {selected && (
        <>
          <p className="muted">
            Status: {selected.status}. Voeg een fysiek gevonden artikel toe, ook
            als er nog geen saldo geregistreerd is. De telling bevestig je via
            Inventarisatie.
          </p>
          <form
            onSubmit={(e) =>
              submit(e, async (f) => {
                await api(
                  "/inventory/counts/" + selected.id + "/lines",
                  json("POST", {
                    version: selected.version,
                    itemId: f.get("itemId"),
                    locationId: f.get("locationId"),
                  }),
                );
                setSelected(await api("/inventory/counts/" + selected.id));
                setNotice("Telregel toegevoegd.");
              })
            }
          >
            <F label="Gevonden artikel">
              <select name="itemId" required>
                <option value="">Kies artikel</option>
                {options(items)}
              </select>
            </F>
            <F label="Opslaglocatie">
              <select name="locationId" required>
                <option value="">Kies locatie</option>
                {options(locations.filter((x) => x.active !== false))}
              </select>
            </F>
            <button
              className="primary"
              disabled={busy || selected.status === "confirmed"}
            >
              Telregel toevoegen
            </button>
          </form>
          <h3 style={{ marginTop: 25 }}>Mutaties sinds start telling</h3>
          {selected.movementsDuringCount?.map((m: Row) => (
            <div className="task-row" key={m.id}>
              <span className="task-text">
                {items.find((i) => i.id === m.itemId)?.name}
                <small>
                  {new Date(m.createdAt).toLocaleString("nl-NL")} · {m.reason}
                </small>
              </span>
              <strong>{m.quantity}</strong>
              <span className="badge">{m.type}</span>
            </div>
          ))}
          {!selected.movementsDuringCount?.length && (
            <p className="muted">Geen tussentijdse mutaties.</p>
          )}
        </>
      )}
    </>
  );
}
