"""The pre-send verification gate — nv-crm's decision table, pinned.

Pure: every verdict is injected, so nothing here talks to Reacher or a
database. Run from apps/leadgen:

    python -m unittest tests.test_reacher_verify -v

The cases are the ones nv-crm's own history made expensive (see the comments
on verdictFrom / mailboxFacts and commit d1318afa), so a regression here is a
regression to a failure that has already happened once, with real bounces.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from outreach import reacher_verify as rv  # noqa: E402


def verdict(reachable="safe", probed=True, catch_all=False, confirmed=True):
    return {
        "reachable": reachable,
        "probed": probed,
        "catch_all": catch_all,
        "confirmed_mailbox": confirmed,
        "result": None,
    }


class MailboxFacts(unittest.TestCase):
    def test_catch_all_is_not_a_confirmed_mailbox(self):
        # Measured in nv-crm on info@remapradio.com, a Google Workspace
        # catch-all that bounced: Reacher sets BOTH flags.
        facts = rv.mailbox_facts({"smtp": {"is_catch_all": True, "is_deliverable": True}})
        self.assertEqual(facts, {"catch_all": True, "confirmed_mailbox": False})

    def test_deliverable_mailbox_is_confirmed(self):
        facts = rv.mailbox_facts({"smtp": {"is_catch_all": False, "is_deliverable": True}})
        self.assertEqual(facts, {"catch_all": False, "confirmed_mailbox": True})

    def test_smtp_error_string_confirms_nothing(self):
        # Reacher returns an error string in place of the object when the
        # sub-check fails.
        self.assertEqual(
            rv.mailbox_facts({"smtp": "Timeout"}),
            {"catch_all": False, "confirmed_mailbox": False},
        )
        self.assertEqual(
            rv.mailbox_facts(None),
            {"catch_all": False, "confirmed_mailbox": False},
        )


class SendGate(unittest.TestCase):
    def test_invalid_is_excluded(self):
        action, _ = rv.send_gate("jane@acme.com", verdict("invalid", confirmed=False))
        self.assertEqual(action, "exclude")

    def test_verified_named_mailbox_sends(self):
        action, _ = rv.send_gate("jane@acme.com", verdict("safe"))
        self.assertEqual(action, "send")

    def test_risky_named_mailbox_sends(self):
        # "deliverable and low-deliverable send, dangerous does not."
        action, _ = rv.send_gate("jane@acme.com", verdict("risky", confirmed=False))
        self.assertEqual(action, "send")

    def test_unknown_from_a_verifier_that_answered_sends(self):
        # Gmail/Outlook refuse SMTP probes; that is a real verdict.
        action, _ = rv.send_gate("jane@gmail.com", verdict("unknown", confirmed=False))
        self.assertEqual(action, "send")

    def test_verifier_outage_is_a_hold_never_a_send(self):
        action, _ = rv.send_gate("jane@acme.com", verdict("unknown", probed=False, confirmed=False))
        self.assertEqual(action, "hold_unverified")

    def test_role_on_catch_all_is_held(self):
        action, _ = rv.send_gate(
            "info@acme.com", verdict("risky", catch_all=True, confirmed=False)
        )
        self.assertEqual(action, "hold_unconfirmed")

    def test_role_with_confirmed_mailbox_sends(self):
        # "neither does a role address whose server states plainly that it
        # exists" — nv-crm d1318afa.
        action, _ = rv.send_gate("sales@acme.com", verdict("safe", confirmed=True))
        self.assertEqual(action, "send")

    def test_invalid_wins_over_everything(self):
        action, _ = rv.send_gate("info@acme.com", verdict("invalid", probed=True, confirmed=False))
        self.assertEqual(action, "exclude")


class RolePrefix(unittest.TestCase):
    def test_nv_crm_list(self):
        for p in ("info", "contact", "hello", "enquiries", "sales", "admin",
                  "support", "team", "office", "mail", "help"):
            self.assertTrue(rv.is_role_prefix(f"{p}@acme.com"), p)
        self.assertFalse(rv.is_role_prefix("jane.doe@acme.com"))


class Unconfigured(unittest.TestCase):
    def test_no_reacher_config_is_unprobed(self):
        # With no cache and no REACHER_URL/SECRET, nothing is known — and the
        # gate must hold, which is what makes a misconfigured deploy fail SAFE.
        with mock.patch.object(rv, "_cache_get", return_value=None), \
             mock.patch.dict(os.environ, {"REACHER_URL": "", "REACHER_SECRET": ""}):
            v = rv.verify_email("jane@acme.com")
            self.assertFalse(v["probed"])
            self.assertEqual(rv.send_gate("jane@acme.com", v)[0], "hold_unverified")


if __name__ == "__main__":
    unittest.main()
