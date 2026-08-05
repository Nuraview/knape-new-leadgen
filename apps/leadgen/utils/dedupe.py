from utils.identity import record_identity_key


def dedupe_records(records: list[dict]) -> list[dict]:
    seen: set[tuple[str, ...]] = set()
    output: list[dict] = []

    for r in records:
        key = record_identity_key(r)
        if key in seen:
            continue
        seen.add(key)
        output.append(r)

    return output
