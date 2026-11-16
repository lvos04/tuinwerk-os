"use client";
import { json, F } from "../ui";
import type { AdvancedToolsState } from "../use-advanced-tools";

export function MinimumTab({ w }: { w: AdvancedToolsState }) {
  const { rows, submit, api, load, reload, setNotice, items, locations, busy } =
    w;
  return (
    <>
      {rows.map((b) => (
        <form
          className="task-row"
          key={b.itemId + b.locationId}
          onSubmit={(e) =>
            submit(e, async (f) => {
              await api(
                "/inventory/balances/" + b.itemId + "/" + b.locationId,
                json("PATCH", {
                  version: b.version,
                  minimum:
                    f.get("minimum") === "" ? null : Number(f.get("minimum")),
                }),
              );
              await load();
              await reload();
              setNotice("Minimumvoorraad bijgewerkt.");
            })
          }
        >
          <span className="task-text">
            <strong>{items.find((x) => x.id === b.itemId)?.name}</strong>
            <small>
              {locations.find((x) => x.id === b.locationId)?.name} · saldo{" "}
              {b.quantity}
            </small>
          </span>
          <F label="Minimum">
            <input
              name="minimum"
              style={{ width: 90 }}
              type="number"
              min="0"
              step="any"
              defaultValue={b.minimum ?? ""}
              placeholder="Geen"
            />
          </F>
          <button className="secondary" disabled={busy}>
            Opslaan
          </button>
        </form>
      ))}
      {!rows.length && (
        <p>
          Boek eerst voorraad op een locatie om een locatie-minimum in te
          stellen.
        </p>
      )}
    </>
  );
}
