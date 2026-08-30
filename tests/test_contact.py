"""The contact form, checked by running its server half.

`api/contact.js` is the only thing left in this project that sends anything
somebody typed, and it is the only place a credential of ours is used at request
time. Four things about it are worth a test, and none of them are about the
shape of JSON:

* **Shut unless switched on.** No RESEND_API_KEY and it must refuse. A form that
  accepts a message it cannot send is worse than one that says it is off -- the
  person walks away believing they have been heard, and nobody finds out.
* **The subject names the product.** That is the whole feature: mail landing in
  a personal Gmail has to be obviously from Handoff3D before it is opened. The
  brand is spelled out in the function -- it cannot import the app's ESM -- so
  the harness diffs it against `web/src/brand.js`.
* **Nothing typed reaches a header.** A newline in the name field is how one
  subject line becomes two headers, and the second one gets to name another
  recipient.
* **The two topic lists agree.** `web/src/contact.js` has the picker's copy and
  the function has its own; an id on one side only is a message refused after it
  has been written.

`web/contact-check.mjs` runs the handler with `fetch` replaced, so nothing here
reaches Resend and nothing here needs a key. This hands its results to pytest
one check at a time, so a failure names what broke -- the same arrangement as
the insights, metrics, parts and flatten harnesses.

Needs Node, and skips without it rather than failing.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
HARNESS = WEB / "contact-check.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not HARNESS.is_file(),
    reason="needs Node",
)


@pytest.fixture(scope="module")
def checks():
    """Every check the harness ran, by label."""
    result = subprocess.run(
        ["node", str(HARNESS)],
        cwd=WEB, capture_output=True, text=True, timeout=120)

    line = next((ln for ln in result.stdout.splitlines()
                 if ln.startswith("RESULTS ")), None)
    if line is None:
        raise AssertionError(
            f"contact-check.mjs did not finish\n{result.stdout}\n{result.stderr}")
    return json.loads(line[len("RESULTS "):])


def test_the_harness_ran_every_check(checks):
    assert len(checks) >= 25


def test_every_check_passed(checks):
    failed = [
        f"{c['label']}: got {json.dumps(c['got'])}, want {json.dumps(c['want'])}"
        for c in checks if not c["ok"]
    ]
    assert not failed, "\n".join(failed)


def test_it_is_still_shut_without_a_key(checks):
    """Named on its own because the failure would not look like one: the form
    would go on accepting messages, and nothing would arrive."""
    shut = [c for c in checks if "no key configured" in c["label"]
            or "sends nothing while refusing" in c["label"]]
    assert len(shut) >= 2, "the harness stopped checking that it is shut"
    assert all(c["ok"] for c in shut)


def test_the_subject_still_says_where_it_came_from(checks):
    """The one thing the feature was asked for: an inbox that can tell at a
    glance which of these came from the app."""
    named = [c for c in checks if "subject" in c["label"]]
    assert len(named) >= 4, "the harness stopped checking the subject"
    assert all(c["ok"] for c in named)


def test_nothing_typed_becomes_a_header(checks):
    injection = next((c for c in checks if "newline in the name" in c["label"]), None)
    assert injection is not None, "the harness stopped checking for header injection"
    assert injection["ok"]


def test_the_picker_and_the_server_offer_the_same_topics(checks):
    """Two copies of one list. A choice the server does not know is refused
    after the message has been written, which is the worst moment for it."""
    agreed = next(
        (c for c in checks if "offers exactly what the server accepts" in c["label"]),
        None)
    assert agreed is not None, "the harness stopped diffing the two topic lists"
    assert agreed["ok"], f"got {agreed['got']}, want {agreed['want']}"
