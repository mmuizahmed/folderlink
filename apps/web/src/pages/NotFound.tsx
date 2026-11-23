import { Link } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter.tsx";
import { Mark } from "../components/Icons.tsx";
import { usePageTitle } from "../session.ts";

export function NotFound() {
  usePageTitle("Page not found · FolderLink");
  return (
    <div className="legal">
      <header className="top">
        <div className="top-inner">
          <Link to="/" aria-label="FolderLink home">
            <Mark />
          </Link>
        </div>
      </header>
      <main className="legal-main">
        <h1>That page is not here</h1>
        <p>The address does not match a FolderLink page.</p>
        <p>
          <Link to="/">Back to FolderLink</Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
