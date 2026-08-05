import { cache } from "react";
import { orm } from "@/lib/db-compat";
import { serializeDecimalsList } from "@/lib/serialize-decimals";

export const getAllCrmData = cache(async () => {
  const [
    accounts,
    opportunities,
    leads,
    contacts,
    contracts,
    saleTypes,
    saleStages,
    campaigns,
    industries,
    contactTypes,
    leadSources,
    leadStatuses,
    leadTypes,
    currencies,
    exchangeRates,
    productCategories,
  ] = await Promise.all([
    orm.crm_Accounts.findMany({ where: { deletedAt: null } }),
    orm.crm_Opportunities.findMany({ where: { deletedAt: null } }),
    orm.crm_Leads.findMany({ where: { deletedAt: null } }),
    orm.crm_Contacts.findMany({ where: { deletedAt: null } }),
    orm.crm_Contracts.findMany({ where: { deletedAt: null } }),
    orm.crm_Opportunities_Type.findMany({}),
    orm.crm_Opportunities_Sales_Stages.findMany({}),
    orm.crm_campaigns.findMany({ where: { deletedAt: null } }),
    orm.crm_Industry_Type.findMany({}),
    orm.crm_Contact_Types.findMany({ orderBy: { name: "asc" } }),
    orm.crm_Lead_Sources.findMany({ orderBy: { name: "asc" } }),
    orm.crm_Lead_Statuses.findMany({ orderBy: { name: "asc" } }),
    orm.crm_Lead_Types.findMany({ orderBy: { name: "asc" } }),
    orm.currency.findMany({ where: { isEnabled: true }, orderBy: { code: "asc" } }),
    orm.exchangeRate.findMany(),
    orm.crm_ProductCategories.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
    }),
  ]);

  const data = {
    accounts,
    opportunities: serializeDecimalsList(opportunities),
    leads,
    contacts,
    contracts: serializeDecimalsList(contracts),
    saleTypes,
    saleStages,
    campaigns,
    industries,
    contactTypes,
    leadSources,
    leadStatuses,
    leadTypes,
    currencies,
    productCategories,
    exchangeRates: exchangeRates.map((r: { fromCurrency: string; toCurrency: string; rate: unknown }) => ({
      fromCurrency: r.fromCurrency,
      toCurrency: r.toCurrency,
      rate: Number(r.rate),
    })),
  };

  return data;
});
