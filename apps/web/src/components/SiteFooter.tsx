import { Link } from "react-router-dom";
import { Mark } from "./Icons.tsx";

const SOURCE = "https://github.com/mmuizahmed/folderlink";
const RELEASES = "https://github.com/mmuizahmed/folderlink/releases";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="foot-brand">
        <Mark />
        <p>
          Let ChatGPT, Claude, and Muse read the project folders you choose — the files never leave
          your computer.
        </p>
      </div>
      <nav className="foot-links" aria-label="Footer">
        <Link to="/docs/getting-started">Docs</Link>
        <a href={RELEASES}>Releases</a>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <a href={SOURCE}>GitHub</a>
      </nav>
      <p className="foot-copy">© 2026 FolderLink · MIT licensed</p>
    </footer>
  );
}
