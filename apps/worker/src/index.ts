import { handleRequest } from "./app.ts";
import type { Env } from "./env.ts";

export { DeviceAgent } from "./device/agent.ts";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
