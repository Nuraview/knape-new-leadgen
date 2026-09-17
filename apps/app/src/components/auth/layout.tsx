import { Logo } from "../common/logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";

type AuthLayoutProps = {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
};

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    /*
     * max(), not `px-4 px-safe`: once installed with viewport-fit=cover the
     * page paints edge to edge, so on a notched phone in landscape the card
     * would sit under the notch and the "Sign in" button under the home
     * indicator. Written as a floor, the padding is the larger of the design's
     * 1rem and the device's inset — one declaration, so the 1rem cannot be
     * lost to the inset's 0 in an ordinary browser tab.
     */
    <div className="flex h-svh w-full flex-col items-center overflow-y-auto bg-background px-[max(1rem,env(safe-area-inset-left))] py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:py-10">
      <div className="w-full max-w-sm space-y-4 my-auto">
        <Logo className="mx-auto flex w-full items-end justify-center" />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{title}</CardTitle>
            {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
          </CardHeader>
          <CardContent className="pt-0">{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}
