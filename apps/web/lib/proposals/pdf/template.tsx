import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

export interface ProposalPdfSection {
  title: string;
  body: string;
}
export interface ProposalPdfLine {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}
export interface ProposalPdfData {
  title: string;
  number: string;
  currency: string;
  brandColor: string;
  companyName?: string;
  companyEmail?: string;
  companyWebsite?: string;
  logoUrl?: string;
  clientName?: string;
  clientCompany?: string;
  clientAddress?: string;
  projectName?: string;
  proposalDate?: string;
  sections: ProposalPdfSection[];
  lineItems: ProposalPdfLine[];
  subtotal: string;
  taxTotal: string;
  transactionFee: string;
  grandTotal: string;
  footerText?: string;
}

const INK = "#1c1917";
const MUTED = "#78716c";
const HAIR = "#e7e5e4";

const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 64,
    paddingHorizontal: 54,
    fontSize: 10,
    color: INK,
    fontFamily: "Helvetica",
    lineHeight: 1.5,
  },
  topbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 34,
  },
  logo: { height: 26, objectFit: "contain" },
  company: { fontSize: 11, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  refTag: { fontSize: 8, color: MUTED, letterSpacing: 2 },

  kicker: { fontSize: 8, color: MUTED, letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" },
  title: { fontSize: 30, fontFamily: "Helvetica-Bold", letterSpacing: -0.5, lineHeight: 1.05 },
  forline: { fontSize: 11, color: MUTED, marginTop: 8 },
  forStrong: { color: INK, fontFamily: "Helvetica-Bold" },

  hr: { height: 2, marginTop: 22, marginBottom: 26, borderRadius: 2 },

  sectionNum: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  sectionTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 5 },
  sectionWrap: { marginBottom: 18 },
  body: { fontSize: 10, color: "#44403c" },

  // pricing
  priceTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 10 },
  thead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 6, marginBottom: 2 },
  th: { fontSize: 8, color: MUTED, letterSpacing: 1, textTransform: "uppercase" },
  row: { flexDirection: "row", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: HAIR },
  cDesc: { flex: 1, paddingRight: 10 },
  cQty: { width: 50, textAlign: "center" },
  cUnit: { width: 80, textAlign: "right", color: MUTED },
  cAmt: { width: 80, textAlign: "right", fontFamily: "Helvetica-Bold" },

  totals: { marginTop: 14, alignItems: "flex-end" },
  totalsBox: { width: 240 },
  tRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  tLabel: { color: MUTED },
  grandRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: INK },
  grandLabel: { fontSize: 11, fontFamily: "Helvetica-Bold", letterSpacing: 1, textTransform: "uppercase" },
  grandVal: { fontSize: 16, fontFamily: "Helvetica-Bold" },

  footer: {
    position: "absolute",
    bottom: 28,
    left: 54,
    right: 54,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: HAIR,
    paddingTop: 10,
    fontSize: 8,
    color: MUTED,
  },
});

function money(v: string, currency: string) {
  const n = parseFloat(v);
  return `${currency} ${Number.isFinite(n) ? n.toFixed(2) : v}`;
}

export function ProposalPdf({ data }: { data: ProposalPdfData }) {
  const brand = data.brandColor || "#c2410c";
  return (
    <Document title={data.title} author={data.companyName ?? "NuraView"}>
      <Page size="A4" style={styles.page}>
        {/* Top bar */}
        <View style={styles.topbar}>
          {data.logoUrl ? (
            <Image src={data.logoUrl} style={styles.logo} />
          ) : (
            <Text style={[styles.company, { color: brand }]}>
              {data.companyName ?? "NuraView"}
            </Text>
          )}
          <Text style={styles.refTag}>
            PROPOSAL · {data.number.padStart(4, "0")}
          </Text>
        </View>

        {/* Title block */}
        <Text style={styles.kicker}>{data.proposalDate ?? "Prepared for you"}</Text>
        <Text style={styles.title}>{data.title}</Text>
        <Text style={styles.forline}>
          Prepared for{" "}
          <Text style={styles.forStrong}>
            {data.clientCompany || data.clientName || "you"}
          </Text>
          {data.projectName ? `  ·  ${data.projectName}` : ""}
        </Text>
        {data.clientAddress ? (
          <Text style={{ fontSize: 9, color: MUTED, marginTop: 3 }}>{data.clientAddress}</Text>
        ) : null}

        <View style={[styles.hr, { backgroundColor: brand }]} />

        {/* Sections */}
        {data.sections
          .filter((s) => s.body)
          .map((s, i) => (
            <View key={i} style={styles.sectionWrap} wrap={false}>
              <Text style={[styles.sectionNum, { color: brand }]}>
                {String(i + 1).padStart(2, "0")}
              </Text>
              <Text style={styles.sectionTitle}>{s.title}</Text>
              <Text style={styles.body}>{s.body}</Text>
            </View>
          ))}

        {/* Pricing */}
        {data.lineItems.length > 0 && (
          <View wrap={false}>
            <Text style={styles.priceTitle}>Investment</Text>
            <View style={styles.thead}>
              <Text style={[styles.th, styles.cDesc]}>Item</Text>
              <Text style={[styles.th, styles.cQty]}>Qty</Text>
              <Text style={[styles.th, styles.cUnit]}>Unit</Text>
              <Text style={[styles.th, styles.cAmt]}>Amount</Text>
            </View>
            {data.lineItems.map((li, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.cDesc}>{li.description}</Text>
                <Text style={styles.cQty}>{parseFloat(li.quantity)}</Text>
                <Text style={styles.cUnit}>{money(li.unitPrice, data.currency)}</Text>
                <Text style={styles.cAmt}>{money(li.lineTotal, data.currency)}</Text>
              </View>
            ))}

            <View style={styles.totals}>
              <View style={styles.totalsBox}>
                <View style={styles.tRow}>
                  <Text style={styles.tLabel}>Subtotal</Text>
                  <Text>{money(data.subtotal, data.currency)}</Text>
                </View>
                {parseFloat(data.taxTotal) > 0 && (
                  <View style={styles.tRow}>
                    <Text style={styles.tLabel}>Tax</Text>
                    <Text>{money(data.taxTotal, data.currency)}</Text>
                  </View>
                )}
                {parseFloat(data.transactionFee) > 0 && (
                  <View style={styles.tRow}>
                    <Text style={styles.tLabel}>Transaction fee</Text>
                    <Text>{money(data.transactionFee, data.currency)}</Text>
                  </View>
                )}
                <View style={styles.grandRow}>
                  <Text style={[styles.grandLabel, { color: brand }]}>Total</Text>
                  <Text style={styles.grandVal}>{money(data.grandTotal, data.currency)}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>{data.footerText || data.companyName || "NuraView"}</Text>
          <Text>
            {[data.companyEmail, data.companyWebsite].filter(Boolean).join("  ·  ")}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
