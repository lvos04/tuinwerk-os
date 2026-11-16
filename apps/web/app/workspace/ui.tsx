"use client";
import {
  LayoutDashboard,
  ClipboardList,
  CalendarDays,
  Wrench,
  MapPin,
  Boxes,
  ChartNoAxesCombined,
  Settings,
  Leaf,
} from "lucide-react";
import { type ReactNode } from "react";
export type Row = Record<string, any>;
export const statuses: Record<string, string> = {
  open: "Open",
  planned: "Gepland",
  in_progress: "Bezig",
  blocked: "Geblokkeerd",
  completed: "Afgerond",
  cancelled: "Geannuleerd",
  archived: "Gearchiveerd",
};
export const priorities: Record<string, string> = {
  low: "Laag",
  normal: "Normaal",
  high: "Hoog",
  critical: "Kritiek",
};
export const nav = [
  ["dashboard", "Overzicht", LayoutDashboard],
  ["tasks", "Taken", ClipboardList],
  ["planning", "Planning", CalendarDays],
  ["assets", "Machines", Wrench],
  ["locations", "Locaties", MapPin],
  ["inventory", "Voorraad", Boxes],
  ["reports", "Rapportages", ChartNoAxesCombined],
  ["settings", "Beheer", Settings],
] as const;
export const date = (v: any) =>
  v
    ? new Date(v).toLocaleDateString("nl-NL", {
        day: "numeric",
        month: "short",
      })
    : "Niet gepland";
export const localDateTime = (s: string) =>
  s
    ? new Date(new Date(s).getTime() - new Date(s).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
export const iso = (s: string) => (s ? new Date(s).toISOString() : null);
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Empty({
  title = "Nog geen gegevens",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Leaf size={28} />
      <h3>{title}</h3>
      <p>
        {children || "Voeg je eerste gegevens toe om hier aan de slag te gaan."}
      </p>
    </div>
  );
}
