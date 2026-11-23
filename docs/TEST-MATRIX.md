# Test matrix

Overall: pass

| Case                                             | Result | Detail                                                                                                                                |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| worker health                                    | pass   |                                                                                                                                       |
| pairing code issued                              | pass   | {"deviceId":"9c61aa11-6e9b-49f5-a0e8-9d57db6bbc79","code":"JRGB-375K","expiresAt":"2026-11-23T02:20:19.296Z"}                         |
| wrong pairing code rejected                      | pass   |                                                                                                                                       |
| pairing code single use accepts first time       | pass   |                                                                                                                                       |
| pairing code cannot be reused                    | pass   |                                                                                                                                       |
| expired pairing code rejected                    | pass   | {"error":{"code":"expired","message":"That pairing code has expired."}}                                                               |
| pairing attempts are rate limited                | pass   | 429                                                                                                                                   |
| device hello signature accepted                  | pass   |                                                                                                                                       |
| device reconnects after the socket drops         | pass   |                                                                                                                                       |
| bad device signature is rejected                 | pass   |                                                                                                                                       |
| device timeout when the socket does not answer   | pass   | {"jsonrpc":"2.0","id":"read_file","result":{"content":[{"type":"text","text":"The device did not respond in time."}],"isError":true}} |
| two devices pair to two users                    | pass   |                                                                                                                                       |
| bridges connect over the websocket               | pass   |                                                                                                                                       |
| folder lists stay on the owning user             | pass   |                                                                                                                                       |
| mcp without a token points at OAuth metadata     | pass   |                                                                                                                                       |
| protected resource metadata names /mcp           | pass   |                                                                                                                                       |
| authorization server requires S256               | pass   |                                                                                                                                       |
| consent screen names the app                     | pass   |                                                                                                                                       |
| authorization code is returned                   | pass   |                                                                                                                                       |
| token endpoint returns access and refresh tokens | pass   |                                                                                                                                       |
| tools/list includes read_file                    | pass   |                                                                                                                                       |
| oauth token reads an allowed file                | pass   |                                                                                                                                       |
| oauth token cannot read a secret                 | pass   |                                                                                                                                       |
| connected app is stored                          | pass   |                                                                                                                                       |
| read_file returns an allowed file                | pass   |                                                                                                                                       |
| secret file is denied                            | pass   |                                                                                                                                       |
| symlink escape is denied                         | pass   |                                                                                                                                       |
| path outside the folder is denied                | pass   |                                                                                                                                       |
| binary file is denied                            | pass   |                                                                                                                                       |
| large file is chunked                            | pass   |                                                                                                                                       |
| directory listing is paginated                   | pass   |                                                                                                                                       |
| token cannot read another user's folder          | pass   |                                                                                                                                       |
| token cannot list another user's folders         | pass   |                                                                                                                                       |
| revoked device no longer serves reads            | pass   | {"jsonrpc":"2.0","id":"read_file","result":{"content":[{"type":"text","text":"No paired device is connected."}],"isError":true}}      |
| the other user's device still answers            | pass   |                                                                                                                                       |
| offline device does not serve reads              | pass   | {"jsonrpc":"2.0","id":"read_file","result":{"content":[{"type":"text","text":"No paired device is connected."}],"isError":true}}      |
