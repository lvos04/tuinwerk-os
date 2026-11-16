"use client";
import { Search, Wrench, MapPin, ChevronRight } from "lucide-react";
import { Empty } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function PlacesScreen({ w }: { w: WorkspaceView }) {
  const {
    search,
    setSearch,
    page,
    assets,
    locations,
    setSelected,
    setDialog,
    run,
    setAssetHistory,
    api,
    name,
  } = w;
  return (
    <>
      <label className="search standalone">
        <Search size={18} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            page === "assets" ? "Zoek een machine" : "Zoek een locatie"
          }
        />
      </label>
      <div className="cards">
        {(page === "assets" ? assets : locations)
          .filter((x) => x.name.toLowerCase().includes(search.toLowerCase()))
          .map((x) => (
            <button
              className="panel entity-card"
              key={x.id}
              onClick={() => {
                setSelected(x);
                setDialog(page === "assets" ? "assetDetail" : "location");
                if (page === "assets")
                  run(async () =>
                    setAssetHistory(await api("/assets/" + x.id + "/history")),
                  );
              }}
            >
              <span className="entity-icon">
                {page === "assets" ? <Wrench /> : <MapPin />}
              </span>
              <span className="badge">{x.status || x.type || "Actief"}</span>
              <h3>{x.name}</h3>
              <p>
                {page === "assets"
                  ? [x.manufacturer, x.model].filter(Boolean).join(" ") ||
                    "Machine / installatie"
                  : x.parentId
                    ? name(locations, x.parentId)
                    : "Hoofdlocatie"}
              </p>
              <footer>
                <MapPin size={14} />
                {page === "assets"
                  ? name(locations, x.locationId)
                  : "Vaste locatie-ID"}
                <ChevronRight size={16} />
              </footer>
            </button>
          ))}
      </div>
      {!(page === "assets" ? assets : locations).length && (
        <Empty
          title={page === "assets" ? "Nog geen machines" : "Nog geen locaties"}
        />
      )}
    </>
  );
}
