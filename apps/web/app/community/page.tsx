import Link from "next/link";
export const metadata = { title: "Veilig samenwerken · TuinWerk OS" };
export default function Page() {
  return (
    <main
      style={{
        maxWidth: 800,
        margin: "auto",
        padding: "40px 24px",
        lineHeight: 1.65,
      }}
    >
      <Link href="/">TuinWerk OS</Link>
      <h1>Veilig samenwerken</h1>
      <p>
        Deze werkruimte is bedoeld voor onderhoud, storingen en samenwerking
        binnen je organisatie. Deel alleen werkgerelateerde informatie die je
        mag delen. Bedreigingen, pesten, discriminatie, seksueel
        misbruikmateriaal en inbreuken op de privacy van anderen zijn niet
        toegestaan.
      </p>
      <h2>Inhoud melden</h2>
      <p>
        Gebruik de meldknop bij een taak, reactie of bijlage en beschrijf wat er
        mis is. Een beheerder kan de melding beoordelen, inhoud verbergen en
        misbruikende accounts blokkeren. Je melding is zichtbaar voor jou en
        bevoegde beheerders.
      </p>
      <h2>Beoordeling door de organisatie</h2>
      <p>
        De organisatie moet meldingen tijdig behandelen. Het tekstfilter helpt
        ingestelde ongewenste formuleringen tegen te houden; het is geen
        volledige automatische controle van teksten of afbeeldingen. Verborgen
        inhoud is niet meer normaal toegankelijk, maar eerder gedownloade
        kopieën en bestaande back-ups worden niet op afstand gewist.
      </p>
      <p>
        Heb je snel hulp nodig of gaat een melding over de beheerder, gebruik
        dan het gepubliceerde supportcontact. Bij direct gevaar gebruik je de
        daarvoor bedoelde hulpdiensten.
      </p>
      <p>
        <Link href="/support">Contact en support</Link> ·{" "}
        <Link href="/privacy">Privacy</Link> · <Link href="/">Naar de app</Link>
      </p>
    </main>
  );
}
