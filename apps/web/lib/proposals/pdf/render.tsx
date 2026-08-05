import { renderToBuffer } from "@react-pdf/renderer";
import { ProposalPdf, type ProposalPdfData } from "./template";

export async function renderProposalPdf(data: ProposalPdfData): Promise<Buffer> {
  return renderToBuffer(<ProposalPdf data={data} />);
}

export type { ProposalPdfData };
