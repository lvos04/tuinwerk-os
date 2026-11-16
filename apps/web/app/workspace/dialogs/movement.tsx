"use client";
import { Field } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function MovementDialog({ w }: { w: WorkspaceView }) {
  const { submit, post, selected, items, locations, tasks, busy } = w;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async (f) => {
          await post("/inventory/movements", {
            operationId: crypto.randomUUID(),
            itemId: f.get("itemId"),
            locationId: f.get("locationId"),
            toLocationId: f.get("toLocationId") || undefined,
            type: f.get("type"),
            quantity: Number(f.get("quantity")),
            reason: f.get("reason"),
            taskId: f.get("taskId") || undefined,
          });
        })
      }
    >
      <Field label="Artikel">
        <select name="itemId" required defaultValue={selected?.id || ""}>
          <option value="">Kies een artikel</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="Mutatie">
          <select name="type">
            <option value="receipt">Aanvulling</option>
            <option value="usage">Verbruik</option>
            <option value="transfer">Verplaatsing</option>
            <option value="correction">Correctie (getekend verschil)</option>
          </select>
        </Field>
        <Field label="Aantal">
          <input type="number" name="quantity" required step="any" />
        </Field>
        <Field label="Opslaglocatie">
          <select required name="locationId">
            <option value="">Kies locatie</option>
            {locations
              .filter((l) => l.active !== false)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Naar locatie (bij verplaatsing)">
          <select name="toLocationId">
            <option value="">Niet van toepassing</option>
            {locations
              .filter((l) => l.active !== false)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field label="Gekoppelde taak">
        <select name="taskId">
          <option value="">Geen taak</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reden / toelichting">
        <input name="reason" required />
      </Field>
      <p className="muted">
        De server controleert beschikbare voorraad. Een mutatie wordt pas na
        bevestiging definitief.
      </p>
      <button className="primary" disabled={busy}>
        Mutatie bevestigen
      </button>
    </form>
  );
}
