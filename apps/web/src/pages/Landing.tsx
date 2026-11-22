import { Link } from "react-router-dom";

export function Landing() {
  return (
    <article className="page">
      <p className="eyebrow">A laptop, a pairing code, and two read-only tools</p>
      <h1>Read a project folder without pasting it into the chat.</h1>
      <p className="lede">
        mcp-bridge runs on the computer that has the files. It keeps an outbound connection to the
        server you pair. Agents call <code>list_files</code> and <code>read_file</code>. They only
        see folders you added locally and approved here.
      </p>
      <div className="actions">
        <Link className="button" to="/connect">
          Pair a device
        </Link>
        <a className="button quiet" href="https://github.com/mmuizahmed/mcp-bridge#local-test">
          Local test
        </a>
      </div>

      <ol className="steps">
        <li>
          <span>01</span>
          <div>
            <h2>Run the bridge</h2>
            <p>The terminal shows a short code. The real folder path stays on the laptop.</p>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <h2>Approve the folder</h2>
            <p>Add it with the bridge command, then approve the label on this site.</p>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <h2>Connect an agent</h2>
            <p>
              Point the client at <code>/mcp</code> with a bearer token. The server picks your
              device from that token.
            </p>
          </div>
        </li>
      </ol>

      <section className="flow" aria-label="Request path">
        <h2>How a tool call moves</h2>
        <div className="flow-row">
          <div>
            <strong>Laptop</strong>
            <span>Allowlist and signature</span>
          </div>
          <div>
            <strong>Worker</strong>
            <span>Token, then one device</span>
          </div>
          <div>
            <strong>Agent</strong>
            <span>list_files and read_file</span>
          </div>
        </div>
      </section>
    </article>
  );
}
