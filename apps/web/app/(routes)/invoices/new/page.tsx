import Container from "@/app/(routes)/components/ui/Container";
import { getTranslations } from "@/lib/i18n/server";
import { orm } from "@/lib/db-compat";
import { InvoiceForm } from "../components/invoice-form";

export default async function NewInvoicePage() {
  const t = await getTranslations("InvoicesPage");

  const [products, taxRates, series, currencies, settings] =
    await Promise.all([
      orm.crm_Products.findMany({
        select: { id: true, name: true },
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
      }),
      orm.invoice_TaxRates.findMany({
        where: { active: true },
        orderBy: { rate: "desc" },
      }),
      orm.invoice_Series.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
      }),
      orm.currency.findMany({
        where: { isEnabled: true },
        orderBy: { code: "asc" },
      }),
      orm.invoice_Settings.findFirst(),
    ]);

  const formLabels = {
    type: t("form.type"),
    account: t("form.account"),
    currency: t("form.currency"),
    series: t("form.series"),
    dueDate: t("form.dueDate"),
    lineItems: t("form.lineItems"),
    addLine: t("form.addLine"),
    product: t("form.product"),
    description: t("form.description"),
    quantity: t("form.quantity"),
    unitPrice: t("form.unitPrice"),
    discount: t("form.discount"),
    taxRate: t("form.taxRate"),
    total: t("form.total"),
    publicNotes: t("form.publicNotes"),
    internalNotes: t("form.internalNotes"),
    save: t("form.save"),
    bankName: t("form.bankName"),
    iban: t("form.iban"),
    swift: t("form.swift"),
    variableSymbol: t("form.variableSymbol"),
  };

  return (
    <Container title={t("new")} description={t("description")}>
      <InvoiceForm
        products={JSON.parse(JSON.stringify(products))}
        taxRates={JSON.parse(JSON.stringify(taxRates))}
        series={JSON.parse(JSON.stringify(series))}
        currencies={JSON.parse(JSON.stringify(currencies))}
        settings={settings ? JSON.parse(JSON.stringify(settings)) : null}
        labels={formLabels}
      />
    </Container>
  );
}
