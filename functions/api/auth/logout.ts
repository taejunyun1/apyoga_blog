import type { AuthEnv, PagesHandler } from "../../lib/env"
import { expiredSessionCookie, isSameOriginJson, json } from "../../lib/http"

export async function handleLogout(request: Request): Promise<Response> {
  if (!isSameOriginJson(request)) return json({ message: "요청을 확인해 주세요." }, 403)
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store", "Set-Cookie": expiredSessionCookie() },
  })
}

export const onRequestPost: PagesHandler<AuthEnv> = ({ request }) => handleLogout(request)
