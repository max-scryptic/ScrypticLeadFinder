import Link from "next/link"
import { cn } from "cn"

import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup } from "@/components/ui/field"
import { siteConfig } from "@/lib/site"

/*
 * One card serves both routes: the copy and the cross-link flip on `mode`,
 * everything else is shared so the two pages cannot drift apart.
 *
 * This is presentation only. The provider button is inert until an auth
 * client is wired up, at which point this becomes a client component with a
 * submit handler and an error slot under the button.
 */

export function LoginForm({
  className,
  mode = "login",
  ...props
}: React.ComponentProps<"div"> & {
  mode?: "login" | "signup"
}) {
  const isSignup = mode === "signup"

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="gap-0 py-8 ring-0 shadow-xl shadow-primary/10 sm:py-10 dark:shadow-black/25">
        <CardHeader className="flex flex-col items-center gap-0 px-6 text-center sm:px-10">
          <Link
            href="/"
            className="mb-8 flex min-h-11 items-center gap-2 px-2 text-lg font-semibold tracking-tight"
          >
            <BrandLogo className="size-11" />
            {siteConfig.name}
          </Link>
          <CardTitle className="text-balance text-2xl">
            {isSignup ? "Create your account" : "Welcome back"}
          </CardTitle>
          {isSignup && (
            <CardDescription className="mt-1.5 text-balance text-base">
              {`Sign up with your Google account to get started`}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="mt-8 px-6 sm:px-10">
          <FieldGroup className="gap-5">
            <Field>
              <Button
                variant="outline"
                type="button"
                className="h-auto min-h-11 whitespace-normal px-4 text-center text-base"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="size-5"
                >
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                {isSignup ? "Sign up with Google" : "Login with Google"}
              </Button>
            </Field>
            <Field>
              <FieldDescription className="text-center">
                {isSignup
                  ? "Already have an account?"
                  : "Don't have an account?"}{" "}
                <Link href={isSignup ? "/login" : "/signup"}>
                  {isSignup ? "Login" : "Sign up"}
                </Link>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        {"By continuing, you agree to our "}
        <Link href="/terms">Terms of Service</Link>
        {" and "}
        <Link href="/privacy">Privacy Policy</Link>.
      </FieldDescription>
    </div>
  )
}
