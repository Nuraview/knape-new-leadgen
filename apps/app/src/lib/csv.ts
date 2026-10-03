/**
 * CSV export, shared by the lists that hand their rows to someone without a CRM
 * login (Inbound, Events).
 *
 * The cockpit has no export endpoint, so the file is built in the browser from
 * whatever the list already fetched. Lifted out of inbound.tsx, where it first
 * lived, so a second list does not re-implement the escaping, the one subtle
 * part, since a company name or a note routinely contains a comma, a quote or a
 * newline that would otherwise break the row.
 */

/** Quote a cell only when it would otherwise break the row. */
export function csvCell(value: unknown): string {
	const s = value === null || value === undefined ? "" : String(value);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A header row plus body rows, already in column order, joined into CSV text. */
export function toCsv(headers: string[], rows: unknown[][]): string {
	return [
		headers.map(csvCell).join(","),
		...rows.map((row) => row.map(csvCell).join(",")),
	].join("\n");
}

/** Trigger a browser download of CSV text, then release the object URL. */
export function downloadCsv(filename: string, content: string): void {
	const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
