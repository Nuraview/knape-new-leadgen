jest.mock("@/lib/db-compat", () => ({
  orm: {
    crm_Opportunities: { aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    crm_Leads: { count: jest.fn() },
    crm_Contacts: { count: jest.fn() },
    crm_Accounts: { count: jest.fn() },
    crm_Contracts: { count: jest.fn() },
    crm_campaign_sends: { count: jest.fn() },
    tasks: { count: jest.fn() },
    users: { count: jest.fn() },
    exchangeRate: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    currency: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

import { orm } from "@/lib/db-compat";
import { getDashboardKPIs } from "@/actions/reports/dashboard";
import type { ReportFilters } from "@/actions/reports/types";

const baseFilters: ReportFilters = { dateFrom: new Date("2025-01-01"), dateTo: new Date("2025-12-31") };

describe("getDashboardKPIs", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns all 10 KPIs", async () => {
    // The action no longer aggregates in SQL — it findMany's the opportunities
    // and converts each budget into the display currency (see sumConverted in
    // actions/reports/dashboard.ts). Order: revCurr, revPrev, pipeCurr, pipePrev.
    (orm.crm_Opportunities.findMany as jest.Mock)
      .mockResolvedValueOnce([{ budget: "100000", currency: null }])
      .mockResolvedValueOnce([{ budget: "80000", currency: null }])
      .mockResolvedValueOnce([{ budget: "500000", currency: null }])
      .mockResolvedValueOnce([{ budget: "400000", currency: null }]);
    (orm.crm_Leads.count as jest.Mock).mockResolvedValueOnce(50).mockResolvedValueOnce(40);
    (orm.crm_Opportunities.count as jest.Mock).mockResolvedValueOnce(25).mockResolvedValueOnce(20);
    (orm.crm_Contacts.count as jest.Mock).mockResolvedValueOnce(100).mockResolvedValueOnce(80);
    (orm.users.count as jest.Mock).mockResolvedValueOnce(30).mockResolvedValueOnce(25);
    (orm.tasks.count as jest.Mock).mockResolvedValueOnce(15).mockResolvedValueOnce(12).mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    (orm.crm_campaign_sends.count as jest.Mock).mockResolvedValueOnce(200).mockResolvedValueOnce(150).mockResolvedValueOnce(80).mockResolvedValueOnce(60);
    (orm.crm_Accounts.count as jest.Mock).mockResolvedValueOnce(20).mockResolvedValueOnce(15);
    (orm.crm_Contracts.count as jest.Mock).mockResolvedValueOnce(5).mockResolvedValueOnce(3);

    const result = await getDashboardKPIs(baseFilters);

    expect(result).toHaveLength(10);
    expect(result[0].label).toBe("totalRevenue");
    expect(result[0].value).toBe(100000);
    expect(result[0].href).toBe("/reports/sales");
  });
});
