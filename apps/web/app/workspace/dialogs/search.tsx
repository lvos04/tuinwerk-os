"use client";
import { type Row } from "../ui";
import { ChevronRight } from "lucide-react";
import type { WorkspaceView } from "../use-workspace";

export function SearchDialog({ w }: { w: WorkspaceView }) {
  const { run, setSearchResults, api, busy, searchResults } = w;
  return (
    <>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(async () =>
            setSearchResults(
              await api("/search?q=" + encodeURIComponent(String(f.get("q")))),
            ),
          );
        }}
      >
        <input
          name="q"
          required
          minLength={2}
          placeholder="Zoek taken, machines, locaties en artikelen"
          aria-label="Zoekterm"
        />
        <button className="primary" disabled={busy}>
          Zoeken
        </button>
      </form>
      {searchResults.map((r) => (
        <a
          className="task-row"
          key={r.type + r.id}
          href={"/?type=" + r.type + "&id=" + r.id}
        >
          <span className="task-text">{r.name}</span>
          <span className="badge">
            {(
              {
                task: "Taak",
                asset: "Machine",
                location: "Locatie",
                item: "Artikel",
              } as Row
            )[r.type] || r.type}
          </span>
          <ChevronRight size={15} />
        </a>
      ))}
    </>
  );
}
