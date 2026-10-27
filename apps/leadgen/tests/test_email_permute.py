"""Name permutation and the acceptance policy of sources.email_permute, pinned.

Pure: nothing here talks to Reacher, DNS or a database. Run from apps/leadgen:

    python -m unittest discover -s tests -p test_email_permute.py -v
"""

from __future__ import annotations

import collections
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sources import email_permute as ep  # noqa: E402


def verdict(reachable="safe", catch_all=False, confirmed=True, probed=True, smtp=None):
    return {"reachable": reachable, "probed": probed, "catch_all": catch_all,
            "confirmed_mailbox": confirmed, "result": {"smtp": smtp or {}}}


class Names(unittest.TestCase):
    def test_initial_only(self):
        self.assertEqual(ep.parse_name("J. Smith"), ep.Name("", "j", "smith"))
        self.assertEqual(ep.parse_name("J Smith"), ep.Name("", "j", "smith"))

    def test_full_name_suffix_and_nickname(self):
        self.assertEqual(ep.parse_name("John (Jack) O'Brien Jr."), ep.Name("john", "j", "obrien"))

    def test_goes_by_middle_name(self):
        self.assertEqual(ep.parse_name("C. Verne Campbell"), ep.Name("verne", "v", "campbell"))

    def test_last_comma_first(self):
        self.assertEqual(ep.parse_name("Smith, John"), ep.Name("john", "j", "smith"))
        self.assertEqual(ep.parse_name("John Smith, PE"), ep.Name("john", "j", "smith"))

    def test_unusable(self):
        for raw in ("", "? ?", "Madonna", "J. S", "Support Team .", "Sales Department"):
            self.assertIsNone(ep.parse_name(raw), raw)


class Formats(unittest.TestCase):
    def test_initial_only_never_builds_full_first_forms(self):
        name = ep.parse_name("J. Smith")
        cands = ep.candidate_formats(name, first_subject=True)
        self.assertEqual(cands, ["flast", "f.last", "lastf", "f_last", "last"])
        self.assertEqual([ep.build(f, name) for f in cands], ["jsmith", "j.smith", "smithj", "j_smith", "smith"])
        self.assertIsNone(ep.build("first.last", name))

    def test_full_name_tries_full_forms_capped(self):
        name = ep.parse_name("John Smith")
        self.assertEqual(ep.candidate_formats(name, first_subject=True)[:2], ["first.last", "flast"])
        self.assertEqual(len(ep.candidate_formats(name, first_subject=True)), ep.MAX_TRIES_FIRST_PERSON)
        self.assertEqual(len(ep.candidate_formats(name, first_subject=False)), ep.MAX_TRIES_LATER_PERSON)

    def test_detect_format(self):
        name = ep.parse_name("Troy Welch")
        self.assertEqual(ep.detect_format("twelch", name), "flast")
        self.assertEqual(ep.detect_format("troy.welch", name), "first.last")
        self.assertIsNone(ep.detect_format("sales", name))

    def test_every_evidenced_format_most_used_first(self):
        self.assertEqual(ep.evidenced_formats(collections.Counter({"first": 2, "first.last": 3})),
                         ["first.last", "first"])
        self.assertEqual(ep.evidenced_formats(collections.Counter({"flast": 1, "first.last": 1})),
                         ["first.last", "flast"])
        self.assertEqual(ep.evidenced_formats(collections.Counter()), [])


class Domains(unittest.TestCase):
    def test_mail_domain_of(self):
        self.assertEqual(ep.mail_domain_of("http://www.kanken-techno.co.jp"), "kanken-techno.co.jp")
        self.assertEqual(ep.mail_domain_of("https://www.abb.com/analytical"), "abb.com")
        self.assertEqual(ep.mail_domain_of("https://shop.acme.com"), "acme.com")
        self.assertEqual(ep.mail_domain_of("https://ie.linkedin.com/company/eaton"), "")
        self.assertEqual(ep.mail_domain_of("gmail.com"), "")
        self.assertEqual(ep.mail_domain_of(""), "")


class Acceptance(unittest.TestCase):
    def test_confirmed_mailbox_is_accepted_without_evidence(self):
        self.assertEqual(ep.accept(verdict(), "jsmith@x.com", evidenced=False), (True, "deliverable"))

    def test_catch_all_and_unknown_need_evidence(self):
        for v in (verdict("risky", catch_all=True, confirmed=False), verdict("unknown", confirmed=False)):
            self.assertEqual(ep.accept(v, "jsmith@x.com", evidenced=False), (False, ""))
            self.assertEqual(ep.accept(v, "jsmith@x.com", evidenced=True), (True, "format_evidenced"))

    def test_invalid_is_never_accepted(self):
        self.assertFalse(ep.accept(verdict("invalid", confirmed=False), "jsmith@x.com", evidenced=True)[0])

    def test_unanswered_is_never_accepted(self):
        v = verdict("unknown", confirmed=False, probed=False)
        self.assertFalse(ep.accept(v, "jsmith@x.com", evidenced=True)[0])

    def test_full_or_disabled_mailbox_is_not_accepted(self):
        v = verdict("risky", catch_all=True, confirmed=False, smtp={"has_full_inbox": True})
        self.assertFalse(ep.accept(v, "jsmith@x.com", evidenced=True)[0])

    def test_risky_answer_on_a_normal_domain_is_not_accepted(self):
        # bills@golighthouse.com, 27 Oct 2026: role-like local part, server did
        # not confirm, domain not catch-all. Evidence of the format is not enough.
        v = verdict("risky", confirmed=False, smtp={"is_deliverable": False})
        self.assertFalse(ep.accept(v, "bills@x.com", evidenced=True)[0])


if __name__ == "__main__":
    unittest.main()
