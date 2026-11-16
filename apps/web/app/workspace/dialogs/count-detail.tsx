"use client";
import { Field, type Row } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function CountDetailDialog({ w }: { w: WorkspaceView }) {
  const { submit, post, selected, name, items, locations, busy } = w;
  if (!selected) return null;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async (f) => {
          await post("/inventory/counts/" + selected.id + "/confirm", {
            version: selected.version,
            lines: selected.lines.map((l: Row, i: number) => ({
              itemId: l.itemId,
              locationId: l.locationId,
              quantity: Number(f.get("quantity-" + i)),
              expectedVersion: l.currentVersion,
            })),
          });
        })
      }
    >
      <p className="muted">
        Controleer de huidige voorraad vóór bevestiging. Verschillen worden als
        correcties opgeslagen.
      </p>
      {selected.lines?.map((l: Row, i: number) => (
        <Field
          key={i}
          label={`${name(items, l.itemId)} · ${name(locations, l.locationId)} · geregistreerd ${l.currentQuantity}`}
        >
          <input
            name={"quantity-" + i}
            type="number"
            min="0"
            step="any"
            defaultValue={l.currentQuantity}
            required
          />
        </Field>
      ))}
      <button
        className="primary"
        disabled={busy || selected.status === "confirmed"}
      >
        Telling bevestigen
      </button>
    </form>
  );
}
