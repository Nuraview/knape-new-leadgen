import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { crmLeads } from "@/drizzle/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const leadId = req.nextUrl.searchParams.get("leadId");

  if (!leadId) {
    return new NextResponse(
      `<html>
        <head>
          <title>Invalid Request</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #09090b; color: #fafafa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background-color: #18181b; border: 1px solid #27272a; padding: 2rem; border-radius: 0.75rem; text-align: center; max-width: 400px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5); }
            h1 { color: #f43f5e; margin-top: 0; font-size: 1.5rem; }
            p { color: #a1a1aa; line-height: 1.5; font-size: 0.95rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Error</h1>
            <p>Invalid or missing Lead ID. Please make sure the link is correct.</p>
          </div>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  try {
    const [lead] = await db
      .select({ id: crmLeads.id, company: crmLeads.company, firstName: crmLeads.firstName, lastName: crmLeads.lastName })
      .from(crmLeads)
      .where(eq(crmLeads.id, leadId))
      .limit(1);

    if (!lead) {
      return new NextResponse(
        `<html>
          <head>
            <title>Lead Not Found</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #09090b; color: #fafafa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background-color: #18181b; border: 1px solid #27272a; padding: 2rem; border-radius: 0.75rem; text-align: center; max-width: 400px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5); }
              h1 { color: #f43f5e; margin-top: 0; font-size: 1.5rem; }
              p { color: #a1a1aa; line-height: 1.5; font-size: 0.95rem; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Not Found</h1>
              <p>The specified lead could not be found or has been deleted.</p>
            </div>
          </body>
        </html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    // Clear active reminder fields in the database
    await db
      .update(crmLeads)
      .set({
        reminderAt: null,
        reminderFollowupPending: false,
      })
      .where(eq(crmLeads.id, leadId));

    const displayName = lead.company || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Lead";

    return new NextResponse(
      `<html>
        <head>
          <title>Reminders Stopped</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
              background: radial-gradient(circle at top, #1e1b4b, #09090b);
              color: #fafafa;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
            }
            .card {
              background-color: rgba(24, 24, 27, 0.85);
              border: 1px solid rgba(39, 39, 42, 0.8);
              backdrop-filter: blur(12px);
              padding: 2.5rem 2rem;
              border-radius: 1rem;
              text-align: center;
              max-width: 420px;
              width: 90%;
              box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4);
            }
            .icon-wrapper {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 64px;
              height: 64px;
              background-color: rgba(16, 185, 129, 0.15);
              border: 2px solid rgba(16, 185, 129, 0.4);
              border-radius: 50%;
              margin-bottom: 1.5rem;
              color: #10b981;
              font-size: 1.75rem;
              font-weight: bold;
            }
            h1 {
              color: #ffffff;
              margin: 0 0 0.5rem 0;
              font-size: 1.5rem;
              font-weight: 600;
            }
            p {
              color: #a1a1aa;
              line-height: 1.6;
              font-size: 0.95rem;
              margin: 0 0 1.5rem 0;
            }
            .lead-name {
              color: #10b981;
              font-weight: 500;
            }
            .badge {
              display: inline-block;
              background-color: rgba(255, 255, 255, 0.05);
              border: 1px solid rgba(255, 255, 255, 0.1);
              padding: 0.25rem 0.75rem;
              border-radius: 9999px;
              font-size: 0.8rem;
              color: #d4d4d8;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon-wrapper">✓</div>
            <h1>Reminders Stopped</h1>
            <p>Active WhatsApp reminder loop has been successfully stopped for:<br/><span class="lead-name">${displayName}</span></p>
            <div class="badge">Nuraview CRM</div>
          </div>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (err) {
    console.error("Error stopping reminders", err);
    return new NextResponse(
      `<html>
        <head>
          <title>System Error</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #09090b; color: #fafafa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background-color: #18181b; border: 1px solid #27272a; padding: 2rem; border-radius: 0.75rem; text-align: center; max-width: 400px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5); }
            h1 { color: #f43f5e; margin-top: 0; font-size: 1.5rem; }
            p { color: #a1a1aa; line-height: 1.5; font-size: 0.95rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>System Error</h1>
            <p>An unexpected error occurred while trying to stop reminders. Please try again later.</p>
          </div>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }
}
