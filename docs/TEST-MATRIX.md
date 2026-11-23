# Test matrix

Overall: pass

| Case                                           | Result | Detail                                                                                                                                |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| worker health                                  | pass   |                                                                                                                                       |
| pairing code issued                            | pass   | {"deviceId":"8dbace38-78ca-4c9b-b13c-d3444199d6d3","code":"23F7-SHJ8","expiresAt":"2026-11-23T00:19:18.346Z"}                         |
| wrong pairing code rejected                    | pass   |                                                                                                                                       |
| pairing code single use accepts first time     | pass   |                                                                                                                                       |
| pairing code cannot be reused                  | pass   |                                                                                                                                       |
| expired pairing code rejected                  | pass   | {"error":{"code":"expired","message":"That pairing code has expired."}}                                                               |
| pairing attempts are rate limited              | pass   | 429                                                                                                                                   |
| device hello signature accepted                | pass   |                                                                                                                                       |
| device reconnects after the socket drops       | pass   |                                                                                                                                       |
| bad device signature is rejected               | pass   |                                                                                                                                       |
| device timeout when the socket does not answer | pass   | {"jsonrpc":"2.0","id":"read_file","result":{"content":[{"type":"text","text":"The device did not respond in time."}],"isError":true}} |
| two devices pair to two users                  | pass   |                                                                                                                                       |
| bridges connect over the websocket             | pass   |                                                                                                                                       |
| folder lists stay on the owning user           | pass   |                                                                                                                                       |
| read_file returns an allowed file              | pass   |                                                                                                                                       |
| secret file is denied                          | pass   |                                                                                                                                       |
| symlink escape is denied                       | pass   |                                                                                                                                       |
| path outside the folder is denied              | pass   |                                                                                                                                       |
| binary file is denied                          | pass   |                                                                                                                                       |
| large file is chunked                          | pass   |                                                                                                                                       |
| directory listing is paginated                 | pass   |                                                                                                                                       |
| token cannot read another user's folder        | pass   |                                                                                                                                       |
| token cannot list another user's folders       | pass   |                                                                                                                                       |
| revoked device no longer serves reads          | pass   | {"jsonrpc":"2.0","id":"read_file","result":{"content":[{"type":"text","text":"No paired device is connected."}],"isError":true}}      |
| the other user's device still answers          | pass   |                                                                                                                                       |
| offline device does not serve reads            | pass   | {"jsonrpc":"2.0","id":"read_file","result":{"content":[{"type":"text","text":"No paired device is connected."}],"isError":true}}      |

Playwright then passed 14 UI checks: screenshot diffs at 1440, 1024, 768, and 390 for landing, pair, and dashboard; no console errors; no horizontal overflow; empty, error, offline, and long-path states; keyboard focus; reduced motion.
