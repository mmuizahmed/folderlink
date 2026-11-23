# MCP OAuth 2.1

ChatGPT and Claude sign in with OAuth 2.1. Access tokens stay opaque, hashed at rest, and last 45 minutes. The panel does not mint them. A migration clears tokens that were created before this flow.

## Endpoints to add

| Endpoint                                      | Purpose                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /.well-known/oauth-protected-resource`   | Tells the client which authorization server guards `/mcp`.                                        |
| `GET /.well-known/oauth-authorization-server` | Metadata: authorization endpoint, token endpoint, registration endpoint, `code` grant, S256 PKCE. |
| `POST /oauth/register`                        | Dynamic client registration. Public clients only.                                                 |
| `GET /oauth/authorize`                        | Authorization code with PKCE. The user is the panel session.                                      |
| `POST /oauth/token`                           | `authorization_code` and `refresh_token`.                                                         |

No implicit grant. No token in the query string. PKCE `code_challenge_method` must be `S256`.

## Tokens

Access tokens stay opaque, 30–60 minutes, hashed at rest. The current issuer is `issueAccessToken` in `apps/worker/src/db.ts`.

Refresh tokens rotate on every use. `rotateRefreshToken` in `apps/worker/src/auth/refresh.ts`:

- Looks up the hash.
- If the row is already revoked or already replaced, revokes every token in that `family_id` and returns `reuse`.
- If it is expired, returns `expired` without issuing a replacement.
- Otherwise inserts the next token and claims the old row with a conditional update (`revoked_at IS NULL`). A lost claim is also reuse, and the family is revoked.

`createD1RefreshStore` speaks to the `refresh_tokens` table from migration `0001_init.sql`. The unit test uses an in-memory store and covers the reuse path: after the old token is presented again, the replacement is dead too.

Authorization codes, once they exist, should be single use, bound to the client, the redirect URI, and the user, and should expire in a few minutes. They are not in the schema yet because the routes that would write them do not exist.

## What is mounted

`GET /mcp` without a bearer token answers 401 and points `WWW-Authenticate` at the protected-resource metadata. Registration is public clients only. The consent screen reuses the Google panel session. Grants show on the dashboard as AI apps and can be revoked.
