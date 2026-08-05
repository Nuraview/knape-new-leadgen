# 1.xlsx read/write — no openpyxl; inline strings only. Dedupe on write via record_identity_key.

from __future__ import annotations

import os
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile

from utils.exclusions import filter_excluded_records
from utils.identity import record_identity_key
from utils.signal_urls import repair_lead_post_url

LEAD_FIELD_ORDER: tuple[str, ...] = (
    "company",
    "website",
    "post_url",
    "source",
    "signal_category",
    "signal_evidence",
    "person_name",
    "job_title",
    "industry_fit",
    "signal_strength",
    "role_relevance",
    "company_fit",
    "icp_score",
    "job_relevance",
    "icp_rationale",
    "email",  # Hunter.io finder + verifier (see milestone2-enrich)
    "company_profile",
    "active_projects",
    "equipment_needs",
    # Milestone acceptance / audit columns (append only — preserves older .xlsx column alignment)
    "lead_source_bucket",  # LinkedIn | Non-LinkedIn (Milestone 1 split)
    "email_verification_status",  # Hunter result: deliverable, risky, etc.
    "email_deliverability_score",  # Hunter 0–100 (higher = more confident)
    "budget_band",  # AI research: project scale / budget hint from signals only
    "equipment_tags",  # AI: comma-separated equipment angles
    "icp_enhanced_score",  # AI 0–10 from research context (string in sheet)
    "data_batch",  # which run a lead first appeared in: "original" or "YYYY-MM-DD" (accumulating master)
    "location",  # "City, ST" (schools/coalitions niche)
    "enrollment",  # school enrollment (company-fit proxy; blank for coalitions)
)

_NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def _q(tag: str) -> str:
    return f"{{{_NS_MAIN}}}{tag}"


_DEFAULT_PATH = Path(__file__).resolve().parent.parent / "1.xlsx"


def _normalize_header_key(cell: str) -> str:
    s = str(cell).strip().lower()
    if s.startswith("\ufeff"):
        s = s[1:].strip().lower()
    return s.replace(" ", "_").replace("-", "_")


def _header_field_indices(header_row: list[str]) -> dict[str, int]:
    """Map canonical field name → column index from the sheet header row."""
    out: dict[str, int] = {}
    known = frozenset(LEAD_FIELD_ORDER)
    for i, cell in enumerate(header_row):
        key = _normalize_header_key(cell)
        if key in known and key not in out:
            out[key] = i
    return out


def _use_header_mapping(indices: dict[str, int]) -> bool:
    """Use header-based mapping when the first row looks like a Milestone header."""
    if "company" not in indices:
        return False
    if len(indices) >= 8:
        return True
    return "icp_score" in indices or "signal_evidence" in indices or "industry_fit" in indices


def load_leads_from_xlsx(path: Path | str | None = None) -> list[dict]:
    from utils.clean import normalize_record

    src = Path(path) if path is not None else _DEFAULT_PATH
    all_rows = _read_sheet_all_rows(src)
    if len(all_rows) < 2:
        return []

    header = all_rows[0]
    indices = _header_field_indices(header)
    by_header = _use_header_mapping(indices)

    out: list[dict] = []
    for cells in all_rows[1:]:
        if by_header:
            d = {
                field: (cells[indices[field]] if field in indices and indices[field] < len(cells) else "")
                for field in LEAD_FIELD_ORDER
            }
        else:
            w = _normalize_width(cells)
            d = {field: (w[i] if i < len(w) else "") for i, field in enumerate(LEAD_FIELD_ORDER)}
        out.append(normalize_record(d))
    return filter_excluded_records([repair_lead_post_url(r) for r in out])


def save_to_xlsx(records: list[dict], path: Path | str | None = None) -> None:
    out = Path(path) if path is not None else _DEFAULT_PATH
    records = filter_excluded_records(records)
    seen: set[tuple[str, ...]] = set()
    new_rows: list[list[str]] = []
    for r in records:
        key = record_identity_key(r)
        if key in seen:
            continue
        seen.add(key)
        row = [_stringify(r.get(key)) for key in LEAD_FIELD_ORDER]
        new_rows.append(row)
    # Safety guard: never destroy an existing non-empty 1.xlsx by overwriting it
    # with zero scraped rows (e.g. all sources returned nothing / hit API limits).
    # Override with LEADS_XLSX_ALLOW_EMPTY_OVERWRITE=1 if a true wipe is intended.
    if not new_rows:
        existing = _read_sheet_all_rows(out)
        existing_data_rows = max(0, len(existing) - 1)  # minus header
        if existing_data_rows > 0 and os.getenv("LEADS_XLSX_ALLOW_EMPTY_OVERWRITE", "") not in ("1", "true", "yes"):
            print(
                f"REFUSING to overwrite {out} ({existing_data_rows} existing rows) with 0 new rows — "
                "scrape produced nothing. Existing data preserved. "
                "Set LEADS_XLSX_ALLOW_EMPTY_OVERWRITE=1 to force.",
                flush=True,
            )
            return
    all_rows: list[list[str]] = [list(LEAD_FIELD_ORDER), *new_rows]
    _write_minimal_xlsx(out, sheet_name="Leads", rows=all_rows)


def _stringify(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value).upper()
    return str(value)


def _read_sheet_all_rows(path: Path) -> list[list[str]]:
    """All worksheet rows (including header row 0). Empty if missing or unreadable."""
    if not path.is_file():
        return []
    try:
        with ZipFile(path, "r") as zf:
            try:
                sheet_xml = zf.read("xl/worksheets/sheet1.xml")
            except KeyError:
                return []
            shared = _load_shared_strings(zf)
            rows = _parse_sheet_rows(sheet_xml, shared)
    except (BadZipFile, ET.ParseError, OSError, ValueError):
        return []
    return rows or []


def _normalize_width(row: list[str]) -> list[str]:
    n = len(LEAD_FIELD_ORDER)
    return [row[i] if i < len(row) else "" for i in range(n)]


def _load_shared_strings(zf: ZipFile) -> list[str]:
    try:
        data = zf.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return []
    out: list[str] = []
    for si in root.findall(f".//{_q('si')}"):
        out.append("".join(si.itertext()))
    return out


def _parse_sheet_rows(sheet_xml: bytes, shared_strings: list[str]) -> list[list[str]]:
    root = ET.fromstring(sheet_xml)
    rows_out: list[list[str]] = []
    for row in root.findall(f".//{_q('row')}"):
        row_map: dict[int, str] = {}
        for c in row.findall(_q("c")):
            ref = c.get("r")
            if not ref:
                continue
            try:
                _r, col_i = _split_cell_ref(ref)
            except ValueError:
                continue
            row_map[col_i] = _cell_inline_text(c, shared_strings)
        if not row_map:
            continue
        width = max(row_map) + 1
        rows_out.append([row_map.get(i, "") for i in range(width)])
    return rows_out


def _split_cell_ref(ref: str) -> tuple[int, int]:
    i = 0
    while i < len(ref) and ref[i].isalpha():
        i += 1
    if i == 0 or i == len(ref):
        raise ValueError(ref)
    letters, digits = ref[:i], ref[i:]
    row_i = int(digits) - 1
    col_i = _letters_to_col_index(letters)
    return row_i, col_i


def _letters_to_col_index(letters: str) -> int:
    n = 0
    for ch in letters.upper():
        if not ("A" <= ch <= "Z"):
            raise ValueError(letters)
        n = n * 26 + (ord(ch) - ord("A") + 1)
    return n - 1


def _cell_inline_text(c: ET.Element, shared_strings: list[str]) -> str:
    t = c.get("t")
    if t == "inlineStr":
        is_el = c.find(_q("is"))
        if is_el is not None:
            return "".join(is_el.itertext())
        return ""
    if t == "s":
        v_el = c.find(_q("v"))
        if v_el is None or v_el.text is None:
            return ""
        try:
            idx = int(v_el.text)
        except ValueError:
            return ""
        if 0 <= idx < len(shared_strings):
            return shared_strings[idx]
        return ""
    v_el = c.find(_q("v"))
    if v_el is not None and v_el.text is not None:
        return v_el.text
    return ""


def _col_letter(col_index: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA."""
    n = col_index + 1
    letters = []
    while n:
        n, rem = divmod(n - 1, 26)
        letters.append(chr(65 + rem))
    return "".join(reversed(letters))


def _xml_escape_cell(text: str) -> str:
    s = escape(text, entities={'"': "&quot;", "'": "&apos;"})
    return s.replace("\r\n", "\n").replace("\r", "\n")


def _sheet_xml(rows: list[list[str]]) -> str:
    nrows = len(rows)
    ncols = len(rows[0]) if rows else 0
    a1 = f"A1:{_col_letter(ncols - 1)}{nrows}" if nrows and ncols else "A1"
    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        f'<dimension ref="{a1}"/>',
        "<sheetData>",
    ]
    for ri, row in enumerate(rows, start=1):
        parts.append(f'<row r="{ri}">')
        for ci, cell in enumerate(row):
            ref = f"{_col_letter(ci)}{ri}"
            t = _xml_escape_cell(cell)
            parts.append(
                f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{t}</t></is></c>'
            )
        parts.append("</row>")
    parts.append("</sheetData></worksheet>")
    return "".join(parts)


def _write_minimal_xlsx(path: Path, sheet_name: str, rows: list[list[str]]) -> None:
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>
"""
    root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
"""
    workbook = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="{escape(sheet_name, entities={'"': '&quot;', "'": '&apos;'})}" sheetId="1" r:id="rId1"/>
</sheets>
</workbook>
"""
    workbook_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>
"""
    sheet = _sheet_xml(rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        zf.writestr("xl/worksheets/sheet1.xml", sheet)
