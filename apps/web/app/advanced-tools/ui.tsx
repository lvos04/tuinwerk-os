"use client";
import { type ReactNode } from "react";
export type Row = Record<string, any>;
export type Api = (path: string, options?: RequestInit) => Promise<any>;
export const F = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);
export const options = (rows: Row[]) =>
  rows.map((r) => (
    <option key={r.id} value={r.id}>
      {r.name || r.title}
    </option>
  ));
export const json = (method: string, body: Row) => ({
  method,
  body: JSON.stringify(body),
});
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
