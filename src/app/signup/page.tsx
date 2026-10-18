import { PageJsonLd } from "@/components/json-ld";
import { LoginForm } from "@/components/login-form";
import { createMetadata, pages } from "@/lib/seo";

export const metadata = createMetadata(pages.signup);

export default function SignupPage() {
  return (
    <main className="flex min-h-svh bg-muted px-4 py-6 sm:px-6 sm:py-8 md:p-10">
      <PageJsonLd page={pages.signup} />
      <div className="mx-auto my-auto w-full max-w-md">
        <LoginForm mode="signup" />
      </div>
    </main>
  );
}
