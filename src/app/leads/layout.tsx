import { AppHeader } from "@/components/app-header"

export default function LeadsLayout({ children }: LayoutProps<"/leads">) {
  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-muted/40">{children}</div>
    </>
  )
}
