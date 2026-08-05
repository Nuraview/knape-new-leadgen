import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

export type SignInFormValues = {
  email: string;
  password: string;
};

type SignInFormProps = {
  onSuccess?: () => void;
  defaultEmail?: string;
};

const signInSchema = z.object({
  email: z.email(),
  password: z.string(),
});

export function SignInForm({ onSuccess, defaultEmail }: SignInFormProps) {
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const form = useForm<SignInFormValues>({
    resolver: standardSchemaResolver(signInSchema),
    defaultValues: {
      email: defaultEmail || "",
      password: "",
    },
  });

  // Set once the password step returns twoFactorRedirect.
  const [needsTotp, setNeedsTotp] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  const submitTotp = async () => {
    setIsPending(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: totpCode,
      });
      if (error) {
        toast.error(error.message || "That code was not accepted");
        return;
      }
      toast.success(t("auth:signInForm.signedInSuccess"));
      setTimeout(() => onSuccess?.(), 300);
    } finally {
      setIsPending(false);
    }
  };

  const onSubmit = async (data: SignInFormValues) => {
    setIsPending(true);
    try {
      const result = await authClient.signIn.email({
        email: data.email,
        password: data.password,
      });

      if (result.error) {
        toast.error(result.error.message || t("auth:signInForm.failedSignIn"));
        return;
      }

      /*
       * Accounts with TOTP enrolled do not get a session here. better-auth
       * answers the password step with twoFactorRedirect and holds the session
       * until a code is verified, so treating this as a successful sign-in
       * would navigate into the app with no cookie and bounce straight back to
       * this form — looking like the password was wrong.
       */
      if (
        (result.data as { twoFactorRedirect?: boolean } | undefined)
          ?.twoFactorRedirect
      ) {
        setNeedsTotp(true);
        return;
      }

      toast.success(t("auth:signInForm.signedInSuccess"));
      setTimeout(() => {
        onSuccess?.();
      }, 500);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("auth:signInForm.failedSignIn"),
      );
    } finally {
      setIsPending(false);
    }
  };

  if (needsTotp) {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">Two-factor code</p>
          <p className="text-xs text-muted-foreground">
            Open your authenticator app and enter the 6-digit code.
          </p>
        </div>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          maxLength={6}
          value={totpCode}
          autoFocus
          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && totpCode.length === 6) submitTotp();
          }}
        />
        <Button
          className="w-full"
          disabled={isPending || totpCode.length !== 6}
          onClick={submitTotp}
        >
          Verify
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <div className="space-y-3">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium">
                  {t("auth:forms.email")}
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("auth:forms.emailPlaceholder")}
                    type="email"
                    autoComplete="email"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium">
                  {t("auth:forms.password")}
                </FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      placeholder={t("auth:forms.passwordPlaceholder")}
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      {...field}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={
                        showPassword
                          ? t("auth:forms.hidePassword")
                          : t("auth:forms.showPassword")
                      }
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Button
          type="submit"
          disabled={isPending}
          size="sm"
          className="w-full mt-4"
        >
          {isPending
            ? t("auth:signInForm.signingIn")
            : t("auth:signInForm.signIn")}
        </Button>
      </form>
    </Form>
  );
}
