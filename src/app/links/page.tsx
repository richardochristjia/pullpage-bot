import LinkTools from "../../components/LinkTools";

export const metadata = { title: "Links · pullpage-bot" };

export default function LinksPage() {
  return (
    <main className="wrap stack">
      <div className="page-head">
        <h1>Links</h1>
        <p className="meta">Cut Figma frames by link, then export the cut frames to PDF. Cut links are added to the export box.</p>
      </div>
      <LinkTools />
    </main>
  );
}
