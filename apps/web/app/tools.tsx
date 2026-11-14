"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
type Row = Record<string, any>;
export function Calendar({
  schedules,
  onMove,
  onEdit,
}: {
  schedules: Row[];
  onMove: (s: Row, start: string, end: string) => Promise<void>;
  onEdit: (s: Row) => void;
}) {
  const [anchor, setAnchor] = useState(new Date().toISOString().slice(0, 10)),
    [dragged, setDragged] = useState<Row | null>(null),
    [mode, setMode] = useState("week");
  const a = new Date(anchor + "T12:00:00");
  const first =
    mode === "month"
      ? new Date(a.getFullYear(), a.getMonth(), 1, 12)
      : new Date(a);
  if (mode === "week")
    first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const days = Array.from(
    {
      length:
        mode === "day"
          ? 1
          : mode === "week"
            ? 7
            : new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate(),
    },
    (_, i) => {
      const d = new Date(first);
      d.setDate(d.getDate() + i);
      return d;
    },
  );
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return (
    <>
      <div className="toolbar">
        <input
          type="date"
          aria-label="Kalenderdatum"
          value={anchor}
          onChange={(e) => setAnchor(e.target.value)}
          style={{ width: 170 }}
        />
        <div className="segmented">
          {[
            ["day", "Dag"],
            ["week", "Week"],
            ["month", "Maand"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={mode === v ? "active" : ""}
              onClick={() => setMode(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <small className="muted">
          Sleep een werkblok naar een andere dag, of open het om tijden aan te
          passen.
        </small>
      </div>
      <div className={"work-calendar " + mode}>
        {days.map((day) => (
          <section
            key={key(day)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragged) return;
              const start = new Date(dragged.startsAt),
                end = new Date(dragged.endsAt),
                duration = end.getTime() - start.getTime();
              start.setFullYear(
                day.getFullYear(),
                day.getMonth(),
                day.getDate(),
              );
              void onMove(
                dragged,
                start.toISOString(),
                new Date(start.getTime() + duration).toISOString(),
              );
              setDragged(null);
            }}
          >
            <h3>
              {day.toLocaleDateString("nl-NL", {
                weekday: "short",
                day: "numeric",
                month: mode === "day" ? "long" : undefined,
              })}
            </h3>
            {schedules
              .filter((s) => key(new Date(s.startsAt)) === key(day))
              .map((s) => (
                <button
                  draggable
                  key={s.id}
                  className={"calendar-event " + (s.shared ? "shared" : "")}
                  onDragStart={() => setDragged(s)}
                  onDragEnd={() => setDragged(null)}
                  onClick={() => onEdit(s)}
                >
                  <small>
                    {new Date(s.startsAt).toLocaleTimeString("nl-NL", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                  <strong>{s.title}</strong>
                  <small>{s.shared ? "Gedeeld" : "Persoonlijk"}</small>
                </button>
              ))}
          </section>
        ))}
      </div>
    </>
  );
}
type Shape = {
  kind: string;
  x: number;
  y: number;
  x2: number;
  y2: number;
  text?: string;
};
export function AnnotationEditor({
  attachment,
  token,
  onSave,
}: {
  attachment: Row;
  token: string;
  onSave: (annotation: Row) => Promise<void>;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [tool, setTool] = useState("arrow"),
    [text, setText] = useState(""),
    [shapes, setShapes] = useState<Shape[]>(
      attachment.annotation?.shapes || [],
    ),
    [draft, setDraft] = useState<Shape | null>(null),
    [busy, setBusy] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let local = "";
    fetch("/api/attachments/" + attachment.id + "/file", {
      headers: { Authorization: "Bearer " + token },
    })
      .then(async (r) => {
        if (!r.ok) throw Error("Foto kan niet worden geladen.");
        local = URL.createObjectURL(await r.blob());
        setUrl(local);
      })
      .catch((e) => setError(e.message));
    return () => {
      if (local) URL.revokeObjectURL(local);
    };
  }, [attachment.id, token]);
  const point = (e: PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * 1000,
      y: ((e.clientY - box.top) / box.height) * 1000,
    };
  };
  const render = (s: Shape, i: number) =>
    s.kind === "text" ? (
      <text
        key={i}
        x={s.x}
        y={s.y}
        fill="#e03c28"
        stroke="white"
        strokeWidth="1"
        fontSize="32"
        fontWeight="700"
      >
        {s.text}
      </text>
    ) : s.kind === "circle" ? (
      <ellipse
        key={i}
        cx={(s.x + s.x2) / 2}
        cy={(s.y + s.y2) / 2}
        rx={Math.abs(s.x2 - s.x) / 2}
        ry={Math.abs(s.y2 - s.y) / 2}
        fill="none"
        stroke="#e03c28"
        strokeWidth="6"
      />
    ) : (
      <line
        key={i}
        x1={s.x}
        y1={s.y}
        x2={s.x2}
        y2={s.y2}
        stroke="#e03c28"
        strokeWidth="6"
        markerEnd="url(#arrowhead)"
      />
    );
  return (
    <>
      <p className="muted">
        Het originele bestand blijft behouden. Voeg pijlen, cirkels en tekst
        toe; de markeringen worden afzonderlijk opgeslagen.
      </p>
      {error && <div className="alert error">{error}</div>}
      <div className="toolbar">
        <div className="segmented">
          {[
            ["arrow", "Pijl"],
            ["circle", "Cirkel"],
            ["text", "Tekst"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={tool === v ? "active" : ""}
              onClick={() => setTool(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          className="secondary"
          disabled={!shapes.length}
          onClick={() => setShapes((s) => s.slice(0, -1))}
        >
          Ongedaan maken
        </button>
        <button className="secondary" onClick={() => setShapes([])}>
          Origineel herstellen
        </button>
      </div>
      {tool === "text" && (
        <input
          aria-label="Annotatietekst"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tekst invoeren, daarna op de foto tikken"
        />
      )}
      {url && (
        <div className="annotation-stage">
          <img src={url} alt={attachment.name} />
          <svg
            ref={svgRef}
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = point(e);
              if (tool === "text") {
                if (text.trim())
                  setShapes([
                    ...shapes,
                    { kind: "text", ...p, x2: p.x, y2: p.y, text },
                  ]);
                return;
              }
              setDraft({ kind: tool, ...p, x2: p.x, y2: p.y });
            }}
            onPointerMove={(e) => {
              if (draft) {
                const p = point(e);
                setDraft({ ...draft, x2: p.x, y2: p.y });
              }
            }}
            onPointerUp={() => {
              if (draft) {
                setShapes([...shapes, draft]);
                setDraft(null);
              }
            }}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 Z" fill="#e03c28" />
              </marker>
            </defs>
            {shapes.map(render)}
            {draft && render(draft, -1)}
          </svg>
        </div>
      )}
      <button
        className="primary"
        disabled={busy || !url}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await onSave({ schemaVersion: 1, coordinateSpace: 1000, shapes });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Annotaties opslaan
      </button>
    </>
  );
}
