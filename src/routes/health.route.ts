import { ok } from "../utils/http-response.js";

export function healthRoute() {
  return ok({
    status: "ok",
  });
}
