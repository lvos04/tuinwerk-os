"use client";
import { Plus, Search, ChevronRight } from "lucide-react";
import { Empty } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function InventoryScreen({ w }: { w: WorkspaceView }) {
  const {
    view,
    setView,
    low,
    setSelected,
    setDialog,
    run,
    setCounts,
    api,
    search,
    setSearch,
    items,
    setBalances,
  } = w;
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          <button
            className={view !== "low" ? "active" : ""}
            onClick={() => setView("list")}
          >
            Alle artikelen
          </button>
          <button
            className={view === "low" ? "active" : ""}
            onClick={() => setView("low")}
          >
            Aanvullijst <span className="count">{low.length}</span>
          </button>
        </div>
        <button
          className="secondary"
          onClick={() => {
            setSelected(null);
            setDialog("movement");
          }}
        >
          <Plus size={16} /> Voorraad boeken
        </button>
        <button
          className="secondary"
          onClick={() =>
            run(async () => {
              setCounts(await api("/inventory/counts"));
              setDialog("counts");
            })
          }
        >
          Inventarisatie
        </button>
      </div>
      <label className="search standalone">
        <Search size={18} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Zoek op naam of artikelnummer"
        />
      </label>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Artikel</th>
              <th>Artikelnummer</th>
              <th>Voorraad</th>
              <th>Minimum</th>
              <th>Eenheid</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(view === "low" ? low : items)
              .filter((i) =>
                (i.name + " " + (i.sku || i.articleNumber))
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((i) => (
                <tr key={i.id}>
                  <td>
                    <button
                      className="link title-link"
                      onClick={() =>
                        run(async () => {
                          setSelected(i);
                          setBalances(
                            await api("/inventory/balances?itemId=" + i.id),
                          );
                          setDialog("itemDetail");
                        })
                      }
                    >
                      {i.name}
                    </button>
                  </td>
                  <td>{i.sku || i.articleNumber}</td>
                  <td>
                    <span
                      className={
                        Number(i.quantity ?? i.totalStock ?? i.stock ?? 0) <
                        Number(i.minimum ?? i.minimumStock)
                          ? "low-stock"
                          : ""
                      }
                    >
                      {i.quantity ?? i.totalStock ?? i.stock ?? 0}
                    </span>
                  </td>
                  <td>{i.minimum ?? i.minimumStock ?? 0}</td>
                  <td>{i.unit}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => {
                        setSelected(i);
                        setDialog("movement");
                      }}
                    >
                      Boeken <ChevronRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!items.length && (
          <Empty title="Je voorraad begint hier">
            Voeg een artikel toe en boek de beginvoorraad op een opslaglocatie.
          </Empty>
        )}
      </div>
    </>
  );
}
