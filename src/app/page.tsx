import { redirect } from "next/navigation"

// The Sources gallery is the app's starting point for now.
export default function Home() {
  redirect("/sources")
}
