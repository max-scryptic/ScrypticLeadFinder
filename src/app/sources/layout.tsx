import { AppHeader } from "@/components/app-header"

export default function SourcesLayout({ children }: LayoutProps<"/sources">) {
  return (
    <>
      <AppHeader />
      <div className="flex-1 bg-muted/40">{children}</div>
    </>
  )
}
