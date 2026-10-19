"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

// Name of the cookie the auth client will set on login. Nothing sets it yet.
const SESSION_COOKIE = "session"

export async function signOut() {
  // TODO: also revoke the session with the auth provider once one is wired up.
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
  redirect("/login")
}
