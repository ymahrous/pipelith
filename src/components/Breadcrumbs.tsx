import Link from "next/link";

/** Visible breadcrumb trail; pair it with breadcrumbLd() for search engines. */
export function Breadcrumbs({ trail }: { trail: readonly (readonly [string, string])[] }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        <li>
          <Link href="/">Home</Link>
        </li>
        {trail.map(([name, href], i) => (
          <li key={href}>
            {i === trail.length - 1 ? <span aria-current="page">{name}</span> : <Link href={href}>{name}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
