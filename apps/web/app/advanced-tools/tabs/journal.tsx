"use client";
import { type Row } from "../ui";
import type { AdvancedToolsState } from "../use-advanced-tools";

export function JournalTab({ w }: { w: AdvancedToolsState }) {
  const { work, load, rows, items, locations } = w;
  return (
    <>
      <button className="secondary" onClick={() => void work(load)}>
        Vernieuwen
      </button>
      {rows.map((m) => (
        <div className="task-row" key={m.id}>
          <span className="task-text">
            <strong>
              {items.find((i) => i.id === m.itemId)?.name || m.itemId}
            </strong>
            <small>
              {locations.find((l) => l.id === m.locationId)?.name} ·{" "}
              {new Date(m.createdAt).toLocaleString("nl-NL")} · {m.reason}
            </small>
          </span>
          <span className="badge">
            {(
              {
                receipt: "Aanvulling",
                usage: "Verbruik",
                transfer: "Verplaatsing",
                correction: "Correctie",
              } as Row
            )[m.type] || m.type}
          </span>
          <strong>{m.quantity}</strong>
        </div>
      ))}
    </>
  );
}
