import { createFileRoute } from "@tanstack/react-router";
import { ErrorTest } from "@/components/ui/error-test";

export const Route = createFileRoute("/test-error")({
  component: TestErrorComponent,
});

function TestErrorComponent() {
  return (
    <div className="min-h-dvh-safe bg-background">
      <ErrorTest />
    </div>
  );
}
