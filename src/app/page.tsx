import { redirect } from "next/navigation"

// The Leads list is the app's starting point.
export default function Home() {
  redirect("/leads")
}
