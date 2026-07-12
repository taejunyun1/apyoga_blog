import { verifySession } from "../../lib/auth"
import { readActiveCredential } from "../../lib/credentials"
import type { AuthEnv, PagesHandler } from "../../lib/env"
import { cookieValue, json } from "../../lib/http"

export async function handleSession(request: Request, env: AuthEnv): Promise<Response> {
  const token = cookieValue(request)
  let authenticated = false
  try {
    if (env.AUTH_USERNAME && env.SESSION_SECRET) {
      const credential = await readActiveCredential(env)
      authenticated = Boolean(token && await verifySession(
        token,
        env.AUTH_USERNAME,
        env.SESSION_SECRET,
        credential.version,
        credential.source === "secret",
      ))
    }
  } catch {
    authenticated = false
  }
  return authenticated ? json({ authenticated: true }) : json({ authenticated: false }, 401)
}

export const onRequestGet: PagesHandler<AuthEnv> = ({ request, env }) => handleSession(request, env)
