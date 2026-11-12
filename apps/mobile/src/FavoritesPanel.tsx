import React, { useState } from "react";
import { Text, View } from "react-native";
import {
  NativeButton as Button,
  NativeField as Field,
  NativeSelect as Select,
  nativeStyles as s,
} from "./NativeWidgets";
type Row = Record<string, any>;
export function FavoritesPanel({
  favorites,
  catalogs,
  online,
  busy,
  onUse,
  onToggle,
}: {
  favorites: Row[];
  catalogs: Record<string, Row[]>;
  online: boolean;
  busy: boolean;
  onUse: (favorite: Row) => void;
  onToggle: (type: string, id: string, remove: boolean) => void;
}) {
  const [manage, setManage] = useState(false),
    [type, setType] = useState("asset"),
    [query, setQuery] = useState("");
  const source =
    type === "asset"
      ? "assets"
      : type === "location"
        ? "locations"
        : "templates";
  const entries = (catalogs[source] || [])
    .filter((row) =>
      `${row.name || row.title}`.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 25);
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.title}>★ Favorieten</Text>
      {favorites.length === 0 && (
        <Text style={s.text}>
          Bewaar veelgebruikte machines, locaties en sjablonen voor een snelle
          melding.
        </Text>
      )}
      {favorites.map((favorite) => (
        <View key={favorite.type + favorite.id} style={s.card}>
          <Button
            disabled={busy || favorite.available === false}
            label={`${favorite.type === "asset" ? "Machine" : favorite.type === "location" ? "Locatie" : "Sjabloon"} · ${favorite.name}`}
            onPress={() => onUse(favorite)}
          />
          {favorite.available === false && (
            <Text>
              Dit object is gearchiveerd en blijft herkenbaar in je favorieten.
            </Text>
          )}
          {manage && (
            <Button
              disabled={busy || !online}
              label="Uit favorieten verwijderen"
              onPress={() => onToggle(favorite.type, favorite.id, true)}
            />
          )}
        </View>
      ))}
      <Button
        label={manage ? "Favorieten sluiten" : "Favorieten kiezen"}
        onPress={() => setManage(!manage)}
      />
      {manage && (
        <>
          <Text style={s.text}>
            Favorieten worden per medewerker op de server bewaard. Offline kun
            je je opgeslagen favorieten blijven gebruiken.
          </Text>
          <Select
            label="Soort"
            value={type}
            onChange={setType}
            options={{
              asset: "Machines",
              location: "Locaties",
              template: "Sjablonen",
            }}
          />
          <Field label="Zoeken" value={query} onChange={setQuery} />
          {entries.map((row) => {
            const selected = favorites.some(
              (favorite) => favorite.type === type && favorite.id === row.id,
            );
            return (
              <Button
                key={row.id}
                disabled={
                  busy ||
                  !online ||
                  (!selected &&
                    (row.active === false || row.status === "archived"))
                }
                label={`${selected ? "★" : "☆"} ${row.name || row.title}`}
                onPress={() => onToggle(type, row.id, selected)}
              />
            );
          })}
        </>
      )}
    </View>
  );
}
