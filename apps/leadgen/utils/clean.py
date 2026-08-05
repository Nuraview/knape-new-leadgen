from __future__ import annotations


def normalize_record(record: dict) -> dict:
    from storage.xlsx_output import LEAD_FIELD_ORDER

    out: dict = {}
    for k in LEAD_FIELD_ORDER:
        v = record.get(k, "")
        if v is None:
            out[k] = ""
        elif isinstance(v, bool):
            out[k] = str(v).upper()
        else:
            out[k] = str(v).strip()
    return out
