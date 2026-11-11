import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "TuinWerk OS · Samen aan het werk",
  description: "Onderhoud, werkplanning en voorraad voor je tuinbouwbedrijf.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
