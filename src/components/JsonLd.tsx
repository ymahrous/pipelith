import { headers } from "next/headers";

/**
 * Structured data for search and answer engines. Content is static and
 * generated on the server from our own constants — never from user input —
 * and "<" is escaped so it can't close the script element.
 */
export async function JsonLd({ data }: { data: object }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // eslint-disable-next-line react/no-danger -- static, server-built JSON-LD; "<" escaped above
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

/** BreadcrumbList for a page trail, e.g. [["Docs", "/docs"], ["Glossary", "/docs/glossary"]]. */
export function breadcrumbLd(siteUrl: string, trail: readonly (readonly [string, string])[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [["Home", "/"] as const, ...trail].map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: siteUrl + path,
    })),
  };
}

/** TechArticle for a documentation page. */
export function articleLd(site: { url: string; name: string; author: string; legalUpdated: string }, page: { path: string; title: string; description: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: page.title,
    description: page.description,
    url: site.url + page.path,
    inLanguage: "en",
    dateModified: site.legalUpdated,
    author: { "@type": "Person", name: site.author },
    publisher: { "@type": "Organization", name: site.name, logo: { "@type": "ImageObject", url: site.url + "/apple-icon.png" } },
    isPartOf: { "@type": "WebSite", name: site.name, url: site.url + "/" },
  };
}
