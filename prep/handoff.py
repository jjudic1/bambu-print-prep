"""The guided handoff (§6.5), written as a page that travels with the file.

§6.5 calls this the product's weakest link: the user has to leave the app, do
several things in Safari, and finish in Bambu Handy. Every one of those steps is
a place they quit. Until the PWA exists (Milestones 3-4) there is no app screen
to put this on, and the console line the launcher prints today -- "upload it to
MakerWorld as a PRIVATE model" -- is not instructions, it is a reminder for
someone who already knows.

So the instructions ship *as a file*, next to the model, and get moved to the
iPad in the same drag. Two properties matter and both come from §6.5:

* **Persistent, not a modal.** It sits in Files beside the model. Print five
  needs it as much as print one, and "show me again" is just opening it again.
* **Self-contained.** One HTML file, no network, picture inlined as a data URI.
  It renders in the Files preview and in Safari, and survives AirDrop, iCloud
  Drive and mail without any of them stripping half of it.

The content is not invented. It is the loop performed and verified end to end on
2026-08-23, recorded in docs/transport-findings.md §A2 and docs/HANDOFF.md --
including both routes through Handy, because the short one is easy to miss and
the long one is what you fall back to when the profile picture is not there.

Deliberately absent: a deep link to MakerWorld's upload page. The upload URL was
never recorded during the A2 run, and a link that lands on a 404 is worse than a
sentence telling the user which button to tap. makerworld.com plus "tap Upload"
is verified; a guessed path is not.

§6.5's copy rules apply to every string here: never "3mf", never "slice", never
"mesh". The file has a name, and that is what it gets called.
"""

from __future__ import annotations

import base64
import html
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

# Where the user goes. Home page, not a guessed upload path -- see module docs.
MAKERWORLD_URL = "https://makerworld.com"

# §6.5: "This part is clunky because Bambu doesn't let apps talk to your printer
# directly." Said once, plainly, so the user knows the awkwardness is not theirs.
HONEST_FRAMING = (
    "This part is clunky, and it is not you. Bambu does not let other apps talk "
    "to your printer directly, so the model has to go up to your own private "
    "page first. It is a handful of taps, once per model, and no computer is "
    "involved."
)

# The long way round, for when the profile picture is not where the last step
# says it is. Both routes were verified; this one is the reliable fallback.
FALLBACK_ROUTE = (
    "Can't find it? In Handy, open the <b>Me</b> tab. There is a row of things "
    "like printing history and print queue -- <b>slide that row to the "
    "right</b> until you see <b>My Creations</b>, and your model is in there."
)


# Profile names carry hardware detail the user never chose and cannot act on --
# "Bambu Lab P1S 0.4 nozzle" is the printer they own plus a fact about it. §6's
# copy rules want the printer, so drop the rest.
_NOZZLE_SUFFIX = re.compile(r"\s+[\d.]+\s*(?:mm)?\s*nozzle\s*$", re.I)


def plain_printer(name: str) -> str:
    return _NOZZLE_SUFFIX.sub("", name or "").strip()


def _dashes(text: str) -> str:
    """Sources here stay ASCII; the page should still read like typography."""
    return text.replace(" -- ", " &mdash; ")


@dataclass
class Instructions:
    """Where the page went, so the caller can point at it."""

    path: Path
    model_name: str


def _picture_tag(preview: Path | None) -> str:
    """Inline the render, so the page stays one file that works offline."""
    if not preview:
        return ""
    try:
        data = Path(preview).read_bytes()
    except OSError:
        # A missing picture costs a nicety, not the instructions. Everything
        # below still stands on its own.
        return ""
    encoded = base64.b64encode(data).decode("ascii")
    return ('<img class="shot" alt="What it will look like" '
            'src="data:image/png;base64,' + encoded + '">')


def _steps(file_name: str) -> list:
    """The verified loop. A heading, then one line of what to actually do."""
    name = html.escape(file_name)
    return [
        ("Get the file onto your iPad",
         "Save <b>" + name + "</b> into the Files app, wherever you like -- "
         "iCloud Drive or On My iPad both work. If it arrived by AirDrop or "
         "e-mail, tap Share and choose <b>Save to Files</b>."),

        ("Open MakerWorld in Safari",
         'Go to <a href="' + MAKERWORLD_URL + '">makerworld.com</a> and sign '
         "in. You only have to sign in once -- it remembers you after that."),

        ("Upload it",
         "Tap <b>Upload</b>, then <b>Choose file</b>, and pick the file you "
         "just saved."),

        ("Add a picture",
         "MakerWorld asks for a photo here, and it will not take the picture "
         "that came with the file. <b>Any real photo from your camera roll</b> "
         "gets you through -- the model is private, so nobody else sees it. "
         "Once it has printed, come back and swap in a photo of the real "
         "thing."),

        ("Set it to Private, then Publish",
         "Give it any title at all. Set who can see it to <b>Private</b> -- "
         "this matters, it keeps the model yours and nobody else sees it. Then "
         "tap <b>Publish</b>."),

        ("Open Bambu Handy and print it",
         "Tap your profile picture, top left, then <b>3D Models</b>. Yours is "
         "at the top of the list. Tap it, pick your printer and your colour, "
         "and print."),
    ]


_CSS = """
:root { color-scheme: light dark;
        --ink: #1a1a1a; --dim: #5b5b5b; --bg: #fbfaf8; --card: #fff;
        --line: #e5e2dc; --accent: #17663f; }
@media (prefers-color-scheme: dark) {
  :root { --ink: #ececec; --dim: #a6a6a6; --bg: #17181a; --card: #212327;
          --line: #34363b; --accent: #6fd39b; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 6vw 5vw 12vw; background: var(--bg); color: var(--ink);
       font: 500 19px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
       -webkit-text-size-adjust: 100%; }
main { max-width: 34rem; margin: 0 auto; }
h1 { font-size: 1.65rem; line-height: 1.2; margin: 0 0 .3rem; }
.sub { color: var(--dim); margin: 0 0 1.6rem; font-size: 1rem; }
.shot { width: 100%; max-width: 20rem; display: block; margin: 0 auto 1.6rem;
        border-radius: 14px; background: var(--card); border: 1px solid var(--line); }
.facts { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
         padding: 1rem 1.15rem; margin: 0 0 2rem; font-size: .97rem; }
.facts div { display: flex; gap: .8rem; padding: .22rem 0; }
.facts span { color: var(--dim); flex: 0 0 5.6rem; }
ol { list-style: none; counter-reset: s; margin: 0; padding: 0; }
li { counter-increment: s; position: relative; padding: 0 0 1.55rem 3.1rem; }
li::before { content: counter(s); position: absolute; left: 0; top: -.1rem;
             width: 2.1rem; height: 2.1rem; border-radius: 50%;
             background: var(--accent); color: var(--bg);
             font-size: .95rem; font-weight: 700;
             display: flex; align-items: center; justify-content: center; }
li h2 { font-size: 1.06rem; margin: .15rem 0 .3rem; }
li p { margin: 0; color: var(--dim); font-size: .97rem; }
li b { color: var(--ink); }
a { color: var(--accent); }
.note { border-left: 3px solid var(--line); padding: .1rem 0 .1rem 1rem;
        margin: 0 0 2rem 3.1rem; color: var(--dim); font-size: .93rem; }
.framing { border-top: 1px solid var(--line); padding-top: 1.4rem;
           color: var(--dim); font-size: .93rem; }
.framing b { color: var(--ink); }
"""


def _facts_block(rows) -> str:
    cells = "".join(
        "<div><span>" + html.escape(k) + "</span>" + html.escape(v) + "</div>"
        for k, v in rows if v)
    return '<div class="facts">' + cells + "</div>" if cells else ""


def render(*, model_name: str, file_name: str, printer: str,
           size_text: str = "", preview=None, material: str = "") -> str:
    """Build the page. Pure string work, so it stays cheap to test."""
    steps = "".join(
        "<li><h2>" + html.escape(head) + "</h2><p>" + _dashes(body) + "</p></li>"
        for head, body in _steps(file_name))

    facts = _facts_block([
        ("File", file_name),
        ("Size", size_text.replace(" - ", " — ")),
        ("Printer", plain_printer(printer)),
        ("Material", material),
    ])

    title = html.escape(model_name)
    return (
        "<!doctype html>\n<html lang=\"en\">\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        "<title>How to print " + title + "</title>\n"
        "<style>" + _CSS + "</style>\n<main>\n"
        "<h1>How to print " + title + "</h1>\n"
        '<p class="sub">It is ready. Here is how to get it to the printer.</p>\n'
        + _picture_tag(preview) + "\n" + facts + "\n"
        "<ol>" + steps + "</ol>\n"
        '<p class="note">' + _dashes(FALLBACK_ROUTE) + "</p>\n"
        '<p class="framing">' + _dashes(HONEST_FRAMING) + "<br><br>\n"
        "Keep this page. You will want it again next time &mdash; it is the "
        "same steps every time. <b>Prepared " + date.today().isoformat()
        + ".</b></p>\n</main>\n</html>\n"
    )


def write(dest, *, model_name: str, file_name: str, printer: str,
          size_text: str = "", preview=None, material: str = "") -> Instructions:
    """Write the page next to the model and say where it went."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(
        render(model_name=model_name, file_name=file_name, printer=printer,
               size_text=size_text, preview=preview, material=material),
        encoding="utf-8")
    return Instructions(path=dest, model_name=model_name)
