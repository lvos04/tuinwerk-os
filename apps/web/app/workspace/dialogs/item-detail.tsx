"use client";
import { MapPin } from "lucide-react";
import { Empty } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function ItemDetailDialog({ w }: { w: WorkspaceView }) {
  const { balances, name, locations, selected, setDialog } = w;
  return (
    <>
      <h3>Voorraad per locatie</h3>
      {balances.map((b) => (
        <div className="task-row" key={b.locationId}>
          <MapPin size={17} />
          <span className="task-text">{name(locations, b.locationId)}</span>
          <strong>
            {b.quantity} {selected?.unit}
          </strong>
        </div>
      ))}
      {!balances.length && <Empty title="Nog geen voorraad geboekt" />}
      <button className="primary" onClick={() => setDialog("movement")}>
        Voorraad boeken
      </button>
    </>
  );
}
