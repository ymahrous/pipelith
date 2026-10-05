import { Breadcrumbs } from "./Breadcrumbs";
import { articleLd, breadcrumbLd, JsonLd } from "./JsonLd";
import { SITE } from "@/lib/site";

/** Shared frame for documentation pages: breadcrumbs, heading, structured data. */
export function DocPage({
  path,
  title,
  description,
  lede,
  children,
  extraLd,
}: {
  path: string;
  title: string;
  description: string;
  lede?: React.ReactNode;
  children: React.ReactNode;
  extraLd?: object;
}) {
  const trail: [string, string][] = path === "/docs" ? [["Docs", "/docs"]] : [["Docs", "/docs"], [title, path]];
  return (
    <article className="doc stack">
      <JsonLd data={breadcrumbLd(SITE.url, trail)} />
      <JsonLd data={articleLd(SITE, { path, title, description })} />
      {extraLd && <JsonLd data={extraLd} />}
      <Breadcrumbs trail={trail} />
      <header className="stack stack--tight">
        <h1>{title}</h1>
        {lede && <p className="doc__lede">{lede}</p>}
      </header>
      {children}
    </article>
  );
}
