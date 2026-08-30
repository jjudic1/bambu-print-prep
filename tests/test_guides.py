"""The static search pages, and the four places their names are repeated.

`web/guides.mjs` holds the copy; `web/build-guides.mjs` writes it into
`web/public/`, where Vercel copies it to the site root. The output is committed
rather than built on deploy, so the first thing checked here is that the two
have not drifted -- a page edited in the generator and not regenerated would
ship the old words with nobody noticing.

The rest is about a slug being written down in four places at once: the
generator, the committed files, the fallback markup in `web/index.html`, and
the `GUIDES` list the React landing screen renders. Getting one of them wrong
does not produce a 404 anybody would see, because the catch-all rewrite in
vercel.json answers an unknown path with the app -- so a dead link looks like a
link that simply did nothing, which is the same symptom the `x-safari-https:`
trap produced and cost a round trip to diagnose last time.

`MODELS` in the generator is prose on a page, not a lookup, and it is checked
against `printers.json` here rather than read from it: a page that quietly
re-renders when the profile index changes is a page whose copy nobody proof-
read, and the two going out of step should fail loudly instead.

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
BUILDER = WEB / "build-guides.mjs"
GENERATOR = WEB / "guides.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not BUILDER.is_file(),
    reason="needs Node and web/build-guides.mjs",
)

SITE = "https://bambu-print-prep.vercel.app"


def _node(script: str):
    """Run a snippet against guides.mjs and read back its JSON."""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=WEB, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise AssertionError(f"node failed\n{result.stdout}\n{result.stderr}")
    return json.loads(result.stdout)


@pytest.fixture(scope="module")
def pages():
    """Every page the generator defines, as plain dicts."""
    return _node(
        "import { PAGES, MODELS, SITE } from './guides.mjs';"
        "console.log(JSON.stringify({"
        "  site: SITE, models: MODELS,"
        "  pages: PAGES.map(p => ({"
        "    slug: p.slug, title: p.title, description: p.description,"
        "    h1: p.h1, faq: p.faq.map(([q]) => q) }))"
        "}))")


@pytest.fixture(scope="module")
def slugs(pages):
    return [p["slug"] for p in pages["pages"]]


# --- the committed output is what the generator would write -----------------

def test_committed_pages_are_in_step_with_the_generator():
    result = subprocess.run(
        ["node", str(BUILDER), "--check"],
        cwd=WEB, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, (
        "web/public/ is out of date -- run `node build-guides.mjs` in web/\n"
        + result.stdout + result.stderr)


def test_every_page_is_committed(slugs):
    missing = [s for s in slugs if not (PUBLIC / f"{s}.html").is_file()]
    assert not missing, f"not written to web/public/: {missing}"


def test_robots_and_sitemap_are_committed():
    assert (PUBLIC / "robots.txt").is_file()
    assert (PUBLIC / "sitemap.xml").is_file()


# --- the four places a slug is written down ---------------------------------

def test_the_landing_screen_links_to_every_page(slugs):
    """LocalApp's GUIDES list, rendered once React has replaced #root."""
    source = (WEB / "src" / "local" / "LocalApp.jsx").read_text(encoding="utf-8")
    block = re.search(r"const GUIDES = \[(.*?)\n\]", source, re.S)
    assert block, "GUIDES list not found in LocalApp.jsx"
    linked = re.findall(r"'/([\w-]+)'", block.group(1))
    assert linked == slugs, (
        "the landing screen and the generator disagree about the pages")


def test_the_fallback_markup_links_to_every_page(slugs):
    """The copy inside #root, which is all a non-rendering crawler ever sees."""
    html = (WEB / "index.html").read_text(encoding="utf-8")
    block = re.search(r'<div id="prerender">.*?</div>', html, re.S)
    assert block, "the #prerender fallback is missing from index.html"
    linked = re.findall(r'href="/([\w-]+)"', block.group(0))
    assert linked == slugs, (
        "index.html and the generator disagree about the pages")


def test_the_sitemap_lists_the_app_and_every_page(slugs):
    sitemap = (PUBLIC / "sitemap.xml").read_text(encoding="utf-8")
    locs = re.findall(r"<loc>(.*?)</loc>", sitemap)
    assert locs == [f"{SITE}/"] + [f"{SITE}/{s}" for s in slugs]


def test_each_page_links_to_all_the_others(slugs):
    """The footer is the only path between them; a stale one strands a page."""
    for slug in slugs:
        html = (PUBLIC / f"{slug}.html").read_text(encoding="utf-8")
        footer = re.search(r"<footer>.*?</footer>", html, re.S)
        assert footer, f"{slug} has no footer"
        linked = sorted(re.findall(r'href="/([\w-]+)"', footer.group(0)))
        assert linked == sorted(s for s in slugs if s != slug), slug


# --- the pages say true things ----------------------------------------------

def test_the_printer_list_matches_the_profile_index(pages):
    """MODELS is prose. When the profiles change, the prose has to be rewritten
    by a person, not silently re-rendered."""
    index = json.loads(
        (WEB / "src" / "data" / "printers.json").read_text(encoding="utf-8"))
    known = []
    for machine in index["printers"]:
        short = machine["model"].replace("Bambu Lab ", "")
        if short not in known:
            known.append(short)
    assert pages["models"] == known, (
        "web/guides.mjs MODELS is out of step with printers.json -- "
        "reword the page, do not just paste the list")


def test_the_site_url_has_no_trailing_slash(pages):
    """Every URL in the pages is SITE + '/' + slug; a trailing slash here would
    produce a canonical nobody can reach."""
    assert pages["site"] == SITE


def test_every_page_carries_the_tags_that_do_the_work(slugs):
    for slug in slugs:
        html = (PUBLIC / f"{slug}.html").read_text(encoding="utf-8")
        assert f'<link rel="canonical" href="{SITE}/{slug}">' in html, slug
        assert '<meta name="description"' in html, slug
        assert '<meta property="og:image"' in html, slug
        assert '"@type": "FAQPage"' in html, slug
        assert "<h1>" in html, slug


def test_the_faq_json_parses(slugs):
    """A JSON-LD block that does not parse is silently ignored, which looks
    exactly like having none at all."""
    for slug in slugs:
        html = (PUBLIC / f"{slug}.html").read_text(encoding="utf-8")
        blocks = re.findall(
            r'<script type="application/ld\+json">\n(.*?)\n</script>',
            html, re.S)
        assert len(blocks) == 2, slug
        for block in blocks:
            json.loads(block)


def test_the_search_console_token_is_still_there():
    """Google re-checks ownership, and a property whose token has gone loses
    its indexing history -- quietly, and long after whatever removed it. The
    tag is public by design, so there is nothing to protect here; it just has
    to survive every future edit to this file's head."""
    html = (WEB / "index.html").read_text(encoding="utf-8")
    assert 'name="google-site-verification"' in html, (
        "the Search Console ownership tag has been dropped from index.html")


def test_the_app_page_json_parses():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    blocks = re.findall(
        r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    assert len(blocks) == 2
    for block in blocks:
        json.loads(block)


def test_nothing_is_escaped_twice(slugs):
    """`&amp;quot;` and friends: an entity written into a field the renderer
    escapes, so its `&` became `&amp;` and the entity ships visible. One did --
    a heading read `What &quot;too big&quot; means` on the live site for a day.
    Nothing about the source says which fields are escaped and which are raw
    HTML, so this catches the mistake by its output instead."""
    doubled = re.compile(r"&amp;(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);")
    for slug in slugs:
        html = (PUBLIC / f"{slug}.html").read_text(encoding="utf-8")
        assert not doubled.findall(html), (
            f"{slug} escapes an entity twice: {doubled.findall(html)[:3]} -- "
            "write the character itself, the renderer escapes that field")


def test_the_faq_answers_are_plain_prose(pages, slugs):
    """They are read twice: into the page as HTML, and into the JSON-LD through
    JSON.stringify, which does not know what an entity is. A tag or an entity
    would come out literal in the structured data while the page looked fine."""
    for slug in slugs:
        html = (PUBLIC / f"{slug}.html").read_text(encoding="utf-8")
        block = re.search(
            r'<script type="application/ld\+json">\n(.*?)\n</script>',
            html, re.S)
        for question in json.loads(block.group(1))["mainEntity"]:
            text = question["acceptedAnswer"]["text"]
            assert "&" not in text and "<" not in text, (slug, text)


def test_no_page_is_thin(slugs):
    """A page with a paragraph on it is not an answer, and gets treated as one
    more doorway. The floor is deliberately low; the point is to catch a page
    that was stubbed and never written."""
    for slug in slugs:
        html = (PUBLIC / f"{slug}.html").read_text(encoding="utf-8")
        body = re.sub(r"<[^>]+>", " ", html.split("<body>")[1])
        assert len(body.split()) > 350, f"{slug} is too thin to be worth having"


# --- the things that would stop any of it being fetched ---------------------

def test_robots_allows_the_answer_engines():
    robots = (PUBLIC / "robots.txt").read_text(encoding="utf-8")
    for agent in ("GPTBot", "ClaudeBot", "PerplexityBot", "OAI-SearchBot"):
        assert f"User-agent: {agent}\nAllow: /" in robots, agent
    assert f"Sitemap: {SITE}/sitemap.xml" in robots
    assert "\nDisallow: /\n" not in robots, "robots.txt blocks the whole site"


def test_robots_keeps_the_dashboard_out():
    robots = (PUBLIC / "robots.txt").read_text(encoding="utf-8")
    assert "Disallow: /dashboard" in robots


def test_vercel_serves_the_pages_without_their_extension():
    """cleanUrls is what puts a committed .html file at an extensionless path.
    Without it every link in every page above is a 404 answered by the app."""
    config = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    assert config.get("cleanUrls") is True


def test_no_rewrite_points_at_a_dot_html_path():
    """`cleanUrls` turns every .html path into a *redirect*, not something that
    serves -- so a rewrite whose destination ends in .html has no target left.

    Measured on the live deploy 2026-08-30, and it took `/local` down: the
    address people were given returned a hard 404, and so did every unknown
    path, because both rewrites pointed at `/index.html`. `/dashboard` went on
    working and hid it, because cleanUrls resolves that one from the filesystem
    before any rewrite is consulted. Destinations are `/` now.

    `/dashboard.html` is the exception and is allowed: that rewrite is dead
    config while cleanUrls is on -- the filesystem answers first -- and is the
    correct destination again the moment it is off."""
    config = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    if not config.get("cleanUrls"):
        return
    offenders = [
        r for r in config["rewrites"]
        if r["destination"].endswith(".html")
        and r["destination"] != "/dashboard.html"
    ]
    assert not offenders, (
        f"cleanUrls is on, so these rewrites have no target: {offenders}")


def test_the_catch_all_still_lets_the_counting_script_through():
    """Unchanged by this work, and re-asserted because the fallback sits right
    next to it: a plain "/(.*)" answers /_vercel/insights/script.js with HTML."""
    config = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    sources = [r["source"] for r in config["rewrites"]]
    assert "/((?!_vercel/|api/).*)" in sources
