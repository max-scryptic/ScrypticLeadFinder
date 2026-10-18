import { PageJsonLd } from "@/components/json-ld";
import { LoginForm } from "@/components/login-form";
import { createMetadata, pages } from "@/lib/seo";

export const metadata = createMetadata(pages.login);

export default function LoginPage() {
  return (
    <main className="flex min-h-svh bg-muted px-4 py-6 sm:px-6 sm:py-8 md:p-10">
      <PageJsonLd page={pages.login} />
      <div className="mx-auto my-auto w-full max-w-md">
        <LoginForm mode="login" />
      </div>
    </main>
  );
}
