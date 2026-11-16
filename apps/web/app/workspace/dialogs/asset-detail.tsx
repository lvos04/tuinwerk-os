"use client";
import { Wrench, ScanLine } from "lucide-react";
import { statuses, date, type Row } from "../ui";
import { MediaGallery } from "../../tools2";
import type { WorkspaceView } from "../use-workspace";

export function AssetDetailDialog({ w }: { w: WorkspaceView }) {
  const {
    selected,
    name,
    locations,
    setDialog,
    assetHistory,
    tasks,
    openTask,
    run,
    token,
    api,
    setAnnotationTarget,
  } = w;
  if (!selected) return null;
  return (
    <>
      <div className="entity-summary">
        <Wrench size={38} />
        <div>
          <p>
            {selected.manufacturer} {selected.model}
          </p>
          <p>{name(locations, selected.locationId)}</p>
          <small>Serienummer: {selected.serialNumber || "—"}</small>
        </div>
      </div>
      <button className="secondary" onClick={() => setDialog("asset")}>
        Machine bewerken
      </button>
      <h3 style={{ marginTop: 24 }}>Werkzaamheden en historie</h3>
      {(
        assetHistory?.tasks || tasks.filter((t) => t.assetId === selected.id)
      ).map((t: Row) => (
        <button
          className="task-row wide"
          key={t.id}
          onClick={() => openTask(t)}
        >
          <span className="task-text">{t.title}</span>
          <span className={"badge " + t.status}>{statuses[t.status]}</span>
        </button>
      ))}
      {!tasks.some((t) => t.assetId === selected.id) && (
        <p className="muted">Nog geen gekoppelde werkzaamheden.</p>
      )}
      {assetHistory?.parts?.length > 0 && (
        <>
          <h3>Gebruikte onderdelen</h3>
          {assetHistory?.parts.map((p: Row) => (
            <div className="task-row" key={p.id}>
              <span className="task-text">{p.itemName}</span>
              <strong>{p.quantity}</strong>
              <small>{date(p.createdAt)}</small>
            </div>
          ))}
        </>
      )}
      <button
        className="secondary"
        onClick={() =>
          run(async () => {
            const r = await fetch("/api/qr/asset/" + selected.id, {
              headers: { Authorization: "Bearer " + token },
            });
            if (!r.ok) throw Error("QR-label kon niet worden gemaakt.");
            const url = URL.createObjectURL(await r.blob());
            const a = document.createElement("a");
            a.href = url;
            a.download = "machine-label.pdf";
            a.click();
            URL.revokeObjectURL(url);
          })
        }
      >
        <ScanLine size={17} /> QR-label downloaden
      </button>
      <h3 style={{ marginTop: 25 }}>Foto’s en handleidingen</h3>
      <MediaGallery
        api={api}
        token={token}
        assetId={selected.id}
        onAnnotate={(a) => {
          setAnnotationTarget(a);
          setDialog("annotation");
        }}
      />
    </>
  );
}
