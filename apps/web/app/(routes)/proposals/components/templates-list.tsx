"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createFromTemplate } from "@/actions/proposals/duplicate";

interface Template {
  id: string;
  templateName: string | null;
  title: string;
}

export function TemplatesList({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (!templates.length) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        No templates yet. Save any proposal as a template to reuse it.
      </div>
    );
  }

  const use = async (id: string) => {
    setBusy(id);
    try {
      const { id: newId } = await createFromTemplate(id);
      toast.success("Proposal created from template");
      router.push(`/proposals/${newId}/edit`);
    } catch {
      toast.error("Failed to create from template");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {templates.map((t) => (
        <div key={t.id} className="rounded-lg border p-4 flex flex-col justify-between">
          <div>
            <div className="font-medium">{t.templateName || t.title}</div>
            <div className="text-xs text-muted-foreground mt-1">{t.title}</div>
          </div>
          <Button
            size="sm"
            className="mt-4 self-start"
            disabled={busy === t.id}
            onClick={() => use(t.id)}
          >
            {busy === t.id ? "Creating…" : "Use template"}
          </Button>
        </div>
      ))}
    </div>
  );
}
