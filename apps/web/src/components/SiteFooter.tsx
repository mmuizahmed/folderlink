import { Link } from "react-router-dom";

const SOURCE = "https://github.com/mmuizahmed/folderlink";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link to="/privacy">Privacy</Link>
      <Link to="/terms">Terms</Link>
      <a href={SOURCE}>GitHub</a>
    </footer>
  );
}
