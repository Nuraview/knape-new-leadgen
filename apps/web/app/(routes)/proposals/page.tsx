import Container from "@/app/(routes)/components/ui/Container";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import { getProposals, getTemplates } from "./data/get-proposals";
import { ProposalsTable } from "./components/proposals-table";
import { TemplatesList } from "./components/templates-list";
import { DesignGallery } from "./components/design-gallery";

export default async function ProposalsPage() {
  const [proposals, templates] = await Promise.all([
    getProposals(),
    getTemplates(),
  ]);

  return (
    <Container
      title="Proposals"
      description="Create, send, and track client proposals."
    >
      <div className="flex justify-end mb-4">
        <Link href="/proposals/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Proposal
          </Button>
        </Link>
      </div>

      <Tabs defaultValue="proposals">
        <TabsList>
          <TabsTrigger value="proposals">
            Proposals ({proposals.length})
          </TabsTrigger>
          <TabsTrigger value="templates">
            Templates ({templates.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="proposals" className="mt-4">
          <ProposalsTable proposals={JSON.parse(JSON.stringify(proposals))} />
        </TabsContent>
        <TabsContent value="templates" className="mt-4 space-y-8">
          <div>
            <h3 className="text-sm font-medium mb-3">Design templates</h3>
            <DesignGallery />
          </div>
          {templates.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-3">Your saved templates</h3>
              <TemplatesList templates={JSON.parse(JSON.stringify(templates))} />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Container>
  );
}
