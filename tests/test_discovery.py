"""IndexNow, and the 404 page that replaced the catch-all rewrite.

Two changes with one thing in common: both are about what happens at a URL
nobody wrote down correctly.

**The 404 page.** `vercel.json` used to answer every unmatched path with the
app, at status 200. A mistyped link came back looking like a working page, so a
dead link here read as a link that did nothing -- and a search engine reading a
200 at an address that is really a miss files it as a soft 404, indexes the junk
URL, or learns to distrust the site. The catch-all is gone; `404.html` is what
Vercel serves instead, with a real status. What is checked here is the part that
would silently undo it: a rewrite creeping back in that swallows everything, or
the page inviting itself to be indexed.

**IndexNow.** The key in `guides.mjs` and the key file at the root of the site
have to be the same string, and when they are not, nothing says so: the API
answers 202 and never crawls. So the file is generated from the constant and
compared here.

Needs Node. Skips without it rather than failing.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
PUBLIC = WEB / "public"
SCRIPT = WEB / "indexnow.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not SCRIPT.is_file(),
    reason="needs Node and web/indexnow.mjs",
)

SITE = "https://bambu-print-prep.vercel.app"


@pytest.fixture(scope="module")
def key():
    result = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import { INDEXNOW_KEY } from './guides.mjs';"
         "console.log(JSON.stringify(INDEXNOW_KEY))"],
        cwd=WEB, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _dry_run(*args):
    result = subprocess.run(
        ["node", str(SCRIPT), "--dry-run", *args],
        cwd=WEB, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


# --- the key, and the file that has to agree with it ------------------------

def test_the_key_is_shaped_the_way_the_api_demands(key):
    """8 to 128 characters, and only letters, digits and dashes. A key outside
    that is rejected outright, which at least fails loudly."""
    assert re.fullmatch(r"[A-Za-z0-9-]{8,128}", key), key


def test_the_key_file_is_committed_and_matches(key):
    """The one failure that is silent: a key file whose contents do not match
    the key in the request. The API answers 202 and never crawls."""
    path = PUBLIC / f"{key}.txt"
    assert path.is_file(), f"{path.name} has not been generated"
    assert path.read_text(encoding="utf-8").strip() == key


def test_the_payload_names_the_key_file_where_it_actually_is(key):
    payload = _dry_run()
    assert payload["key"] == key
    assert payload["keyLocation"] == f"{SITE}/{key}.txt"
    assert payload["host"] == "bambu-print-prep.vercel.app"


def test_it_submits_every_url_in_the_sitemap():
    """The sitemap is the list search engines already agree on; submitting
    anything else would mean two lists to keep in step."""
    sitemap = (PUBLIC / "sitemap.xml").read_text(encoding="utf-8")
    assert _dry_run()["urlList"] == re.findall(r"<loc>(.*?)</loc>", sitemap)


def test_a_named_page_can_be_submitted_on_its_own():
    """What you reach for after shipping one page, rather than re-announcing
    the whole site. A bare slug, a rooted path and a full URL are all things a
    person types, and the API takes only the last of the three."""
    for given in ("simplyprint-on-ipad", "/simplyprint-on-ipad",
                  f"{SITE}/simplyprint-on-ipad"):
        assert _dry_run(given)["urlList"] == [f"{SITE}/simplyprint-on-ipad"]


# --- the 404 page, and the rewrite that must not come back ------------------

def test_the_404_page_is_committed():
    assert (PUBLIC / "404.html").is_file(), (
        "404.html is missing -- run `node build-guides.mjs` in web/")


def test_the_404_page_refuses_to_be_indexed():
    """A 404 page that invites indexing is its own kind of soft 404."""
    html = (PUBLIC / "404.html").read_text(encoding="utf-8")
    assert '<meta name="robots" content="noindex">' in html


def test_the_404_page_is_not_in_the_sitemap_or_llms_txt():
    for name in ("sitemap.xml", "llms.txt"):
        text = (PUBLIC / name).read_text(encoding="utf-8")
        assert "404" not in text, f"404.html should not be listed in {name}"


def test_the_404_page_offers_a_way_out():
    """Somebody who mistyped a guide URL should be one tap from the right one.
    An apology with no links is how a 404 wastes the visit it was handed."""
    html = (PUBLIC / "404.html").read_text(encoding="utf-8")
    slugs = _node_slugs()
    linked = set(re.findall(r'href="/([\w-]+)"', html))
    assert set(slugs) <= linked, "the 404 page does not link every guide"
    assert 'href="/"' in html


def _node_slugs():
    result = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import { PAGES } from './guides.mjs';"
         "console.log(JSON.stringify(PAGES.map(p => p.slug)))"],
        cwd=WEB, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_no_rewrite_swallows_the_whole_site_again():
    """The bug this replaced. A catch-all with `/` as its destination answers a
    mistyped address with the app at status 200, and Vercel's 404 handling
    never gets a chance to run. `/local` and `/dashboard` keep their own
    rewrites -- those are addresses people were given, and they are exact."""
    config = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    exact = {"/local", "/dashboard"}
    for rule in config["rewrites"]:
        assert rule["source"] in exact, (
            f"{rule['source']} is broader than a named path -- an unmatched "
            "URL must reach 404.html, not the app")


def test_the_counting_script_and_the_function_are_still_reachable():
    """Why the old catch-all had a negative lookahead. /_vercel/insights/
    script.js and /api/insights were both answered with a page of HTML by a
    plain "/(.*)" fallback -- the script tag then parsed as HTML and counted
    nothing, silently. With no catch-all at all the trap is gone; this asserts
    the property rather than the old regex, so it keeps holding if a fallback
    is ever reintroduced."""
    config = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    for path in ("/_vercel/insights/script.js", "/api/insights"):
        for rule in config["rewrites"]:
            assert not re.fullmatch(rule["source"], path), (
                f"{rule['source']} swallows {path}")
