"""Build the Milestone 6 observation sheet as a PDF you can print and write on.

This script is the source, not a converter. The protocol used to be markdown,
which was the wrong shape for it: the person running this test is holding it on
a clipboard beside an iPad, ticking a setup list and writing timestamps while
someone struggles in front of them. That wants fixed pages, real checkboxes and
ruled lines to write on -- none of which markdown has.

So the words live here, in one place, and the layout lives with them.

    .venv\\Scripts\\python.exe docs/make_user_test_pdf.py

Writes docs/milestone-6-user-test.pdf. Letter paper, because that is what the
printer on this machine has.
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageBreak, PageTemplate, Paragraph,
    Spacer, Table, TableStyle,
)

OUT = Path(__file__).resolve().parent / "milestone-6-user-test.pdf"

INK = colors.HexColor("#1a1a1a")
DIM = colors.HexColor("#5b5b5b")
LINE = colors.HexColor("#c9c6c0")
RULE = colors.HexColor("#8e8b85")
ACCENT = colors.HexColor("#17663f")
WARN = colors.HexColor("#9c2f26")

_base = getSampleStyleSheet()

S = {
    "title": ParagraphStyle(
        "title", parent=_base["Title"], fontName="Helvetica-Bold",
        fontSize=21, leading=25, alignment=TA_LEFT, textColor=INK,
        spaceAfter=2),
    "sub": ParagraphStyle(
        "sub", parent=_base["Normal"], fontName="Helvetica",
        fontSize=10.5, leading=14, textColor=DIM, spaceAfter=14),
    "h": ParagraphStyle(
        "h", parent=_base["Heading2"], fontName="Helvetica-Bold",
        fontSize=13, leading=16, textColor=INK, spaceBefore=16, spaceAfter=5),
    "body": ParagraphStyle(
        "body", parent=_base["Normal"], fontName="Helvetica",
        fontSize=10, leading=14.2, textColor=INK, spaceAfter=7),
    "small": ParagraphStyle(
        "small", parent=_base["Normal"], fontName="Helvetica",
        fontSize=9, leading=12.5, textColor=DIM, spaceAfter=6),
    "rule": ParagraphStyle(
        "rule", parent=_base["Normal"], fontName="Helvetica-Bold",
        fontSize=15, leading=19, textColor=WARN, spaceAfter=6),
    "script": ParagraphStyle(
        "script", parent=_base["Normal"], fontName="Helvetica-Oblique",
        fontSize=11.5, leading=16, textColor=INK,
        leftIndent=10, rightIndent=10, spaceBefore=4, spaceAfter=4),
    "cell": ParagraphStyle(
        "cell", parent=_base["Normal"], fontName="Helvetica",
        fontSize=9.3, leading=12.4, textColor=INK),
}


def para(text, style="body"):
    return Paragraph(text, S[style])


def boxed(flowables, fill=None, border=LINE, pad=10):
    """A bordered panel, for the things that must not be skim-read past."""
    t = Table([[flowables]], colWidths=[6.9 * inch])
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1, border),
        ("BACKGROUND", (0, 0), (-1, -1), fill or colors.white),
        ("LEFTPADDING", (0, 0), (-1, -1), pad),
        ("RIGHTPADDING", (0, 0), (-1, -1), pad),
        ("TOPPADDING", (0, 0), (-1, -1), pad),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def tickbox(size=9.5):
    """A fixed square.

    Bordering the table cell instead stretches the box to the row height, so a
    two-line item gets a tall rectangle. A nested fixed-size table keeps it
    square whatever the text beside it does.
    """
    b = Table([[""]], colWidths=[size], rowHeights=[size])
    b.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.9, RULE)]))
    return b


def checklist(items, width=6.9 * inch):
    """Boxes to tick, drawn rather than typed -- the built-in fonts have no
    ballot-box glyph and it renders as a filled block if you try."""
    rows = [[tickbox(), para(text, "cell")] for text in items]
    t = Table(rows, colWidths=[0.34 * inch, width - 0.34 * inch])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def write_rows(n, heights=0.34 * inch, cols=(0.85, 5.35, 0.7), header=None):
    """Ruled blank rows. This is the half of the document that gets used."""
    data = []
    if header:
        data.append([Paragraph(f"<b>{h}</b>", S["cell"]) for h in header])
    data += [["", "", ""] for _ in range(n)]
    t = Table(data, colWidths=[c * inch for c in cols],
              rowHeights=([0.26 * inch] if header else []) + [heights] * n)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, 0), (-1, -1), 0.6, LINE),
        ("LINEBEFORE", (1, 0), (1, -1), 0.6, LINE),
        ("LINEBEFORE", (2, 0), (2, -1), 0.6, LINE),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0eeea")),
            ("LINEBELOW", (0, 0), (-1, 0), 0.9, RULE),
        ]
    t.setStyle(TableStyle(style))
    return t


def lines(n, width=6.9 * inch, gap=0.32 * inch):
    """Plain ruled lines to write an answer on."""
    t = Table([[""] for _ in range(n)], colWidths=[width], rowHeights=[gap] * n)
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.6, LINE)]))
    return t


def decorate(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(DIM)
    canvas.drawString(0.8 * inch, 0.55 * inch, "EZslicer3D - Milestone 6 observation sheet")
    canvas.drawRightString(7.7 * inch, 0.55 * inch, f"page {doc.page}")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(0.8 * inch, 0.72 * inch, 7.7 * inch, 0.72 * inch)
    canvas.restoreState()


def story():
    s = []
    s.append(para("Watching someone print, without you", "title"))
    s.append(para(
        "Milestone 6. The only milestone that proves anything, and it has never "
        "been attempted. Fill this in as it happens - not afterwards.", "sub"))

    s.append(boxed([
        para("The one rule: do not help.", "rule"),
        para(
            "Not a hint, not a nudge, not \"try tapping that\". The moment you "
            "help, the run stops being evidence - you have replaced the thing "
            "being measured with yourself. If they ask you something, write the "
            "question down and say:", "body"),
        para("\"Pretend I'm not here. Do whatever you'd do on your own.\"", "script"),
        para(
            "The urge to help will be strong, because you built it and you can "
            "see the button they are missing. <b>That urge is the data.</b> If "
            "they are genuinely stuck and distressed, stop, and record it as a "
            "hard stop. A hard stop is the most valuable result this can produce.",
            "body"),
    ], fill=colors.HexColor("#fdf6f5"), border=WARN))

    s.append(para("The goal", "h"))
    s.append(para(
        "Not to find out whether the app works. To find out <b>where the person "
        "stops</b>. Those are different questions and only the second has ever "
        "produced a fix here.", "body"))

    s.append(para("Who", "h"))
    s.append(para(
        "One person who has never used this, does not 3D print, and was not in "
        "any conversation about it. A partner or friend is fine; a colleague who "
        "has heard you talk about it is not - they will already know what "
        "\"plate\" means, and that is the thing being tested.", "body"))
    s.append(para(
        "<b>One person is enough for the first run.</b> Do not line up five. The "
        "first will hit so much that running the others before fixing anything "
        "wastes four people.", "body"))

    s.append(para("Before they arrive", "h"))
    s.append(checklist([
        "Printer on, filament loaded, already paired to Bambu Handy.",
        "MakerWorld account already signed in on the iPad's Safari. (Testing "
        "signup is a different, longer test - and it is Bambu's flow, not ours.)",
        "Bambu Handy installed and signed in to the same account.",
        "A real model already saved in the iPad's Files app - something from "
        "MakerWorld <b>with more than one loose part</b>, so the split button is "
        "reachable. Not a test cube.",
        "The app open at the /local page. Nothing else open.",
        "iPad auto-lock set long. A screen sleeping mid-task is your bug, not theirs.",
        "Screen recording running, if they consent. You will miss things live.",
        "This sheet, a pen, and a clock.",
    ]))

    s.append(PageBreak())

    s.append(para("What you say", "h"))
    s.append(para("Once, then stop talking:", "body"))
    s.append(boxed([para(
        "\"This is a thing for printing a 3D model on my printer. There's a file "
        "called ______________ in Files. Please make it print. Think out loud if "
        "you can.\"", "script")]))
    s.append(Spacer(1, 7))
    s.append(para(
        "<b>Do not say:</b> plate, part, orient, mesh, slice, container, upload, "
        "MakerWorld, or Handy. If you name a step, you have taught them the step.",
        "body"))

    s.append(para("Marks", "h"))
    marks = Table([
        [Paragraph("<b>P</b>", S["cell"]), para("a pause over about ten seconds, no action", "cell"),
         Paragraph("<b>Q</b>", S["cell"]), para("they asked you something (write it down)", "cell")],
        [Paragraph("<b>W</b>", S["cell"]), para("a wrong turn - had to undo or go back", "cell"),
         Paragraph("<b>X</b>", S["cell"]), para("hard stop", "cell")],
    ], colWidths=[0.3 * inch, 3.15 * inch, 0.3 * inch, 3.15 * inch])
    marks.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    s.append(marks)
    s.append(para(
        "Write down <b>verbatim</b> anything they call something by a different "
        "name than the app does - \"the thingy\", \"the printy button\". That is "
        "the app's vocabulary being wrong, and it is the cheapest fix you will "
        "ever get.", "small"))

    s.append(Spacer(1, 4))
    s.append(write_rows(15, header=["Time", "What they did / said", "Mark"]))

    s.append(PageBreak())
    s.append(write_rows(25, header=["Time", "What they did / said", "Mark"]))

    s.append(PageBreak())

    s.append(para("Where the evidence says they will stall", "h"))
    s.append(para(
        "Predictions, written in advance so you notice them live rather than "
        "reconstruct them after. <b>A prediction that does not fire is as useful "
        "as one that does</b> - it means attention is going to the wrong place.",
        "small"))

    predictions = [
        ("Getting started at all",
         "Does the Files picker show the model, or grey it out? An accept "
         "attribute on the file input made iPads refuse every file once. It is "
         "gone and must not come back."),
        ("Three files at the end",
         "New and never watched. The output is the model, a picture, and a "
         "how-to page. Do they save all three? Can they tell which is which? "
         "<b>Do they ever open the how-to page?</b> If they ignore it, it is not "
         "instructions - it is a file nobody opens, and the premise needs rethinking."),
        ("The photo, at MakerWorld",
         "The known worst step. MakerWorld refuses our render and demands a real "
         "photo. The how-to page warns about this. Do they read it, believe it, "
         "or grind against the form first? Predicted: a long pause and a Q."),
        ("Private",
         "If they miss it the model is public. Note it, do not correct it during "
         "the run, fix it yourself afterwards."),
        ("Finding it in Bambu Handy",
         "Two routes; the fallback exists because the short one is easy to miss. "
         "Which do they take? Does the wording still match what Handy shows "
         "today? That copy was verified 2026-08-23 and Bambu ships updates."),
        ("Colour",
         "New, deliberate, and ours. Colour is only a picture - the printer uses "
         "whatever filament is loaded. If they pick blue and expect blue out of "
         "the printer, that is a real expectation mismatch. The panel says so in "
         "words. Find out whether words are enough."),
        ("Size",
         "Does \"Keep its shape\" mean anything to them? Do they notice when the "
         "model is bigger than the bed? The bar turning red is the only signal."),
        ("Split",
         "Predicted: they never touch it, because nothing tells them to. If they "
         "hit the bed limit and do not find Split, that finding is worth more "
         "than the button."),
    ]
    rows = [[tickbox(), Paragraph(f"<b>{i}. {head}</b><br/>{body}", S["cell"])]
            for i, (head, body) in enumerate(predictions, 1)]
    t = Table(rows, colWidths=[0.34 * inch, 6.56 * inch])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE),
    ]))
    s.append(t)

    s.append(PageBreak())

    s.append(para("What counts as done", "h"))
    s.append(para(
        "<b>Done = the printer is printing.</b> Not \"they got to Handy\", not "
        "\"the file uploaded\". Filament moving.", "body"))
    tally = Table([
        [para("Time to printing, from your one sentence", "cell"), ""],
        [para("Q count - every question they had to ask", "cell"), ""],
        [para("Hard stop? Where?", "cell"), ""],
    ], colWidths=[3.4 * inch, 3.5 * inch], rowHeights=[0.42 * inch] * 3)
    tally.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LINEBELOW", (1, 0), (1, -1), 0.7, RULE),
    ]))
    s.append(tally)
    s.append(Spacer(1, 8))
    s.append(para(
        "There is no target number. This run establishes the number; later runs "
        "are measured against it.", "small"))

    s.append(para("Afterwards - ask in this order, write before discussing", "h"))
    for q in ["\"Talk me through what you thought was happening, at each point.\"",
              "\"Was there a moment you thought it had gone wrong?\"",
              "\"If you had to do it again tomorrow, what would you dread?\""]:
        s.append(para(f"<b>{q}</b>", "body"))
        s.append(lines(3))
        s.append(Spacer(1, 8))

    s.extend([
        para("Then do not fix anything for a day", "h"),
        para(
            "The urge after watching is to patch the specific button they missed. "
            "Most of what you saw will be one or two underlying problems wearing "
            "several costumes, and you can only see that once the sting wears "
            "off. Write the findings down first; decide second. They go in "
            "docs/HANDOFF.md, to the same standard as everything else there: "
            "what was observed, not what it means.", "body"),
        para("What this is not", "h"),
        para(
            "Not a demo - if you find yourself presenting, stop. Not a usability "
            "score - one person is a flashlight, not a sample. Not a test of "
            "MakerWorld or Bambu Handy, which will produce failures you cannot "
            "fix - record those anyway, because the delivery loop rests on them.",
            "body"),
    ])
    return s


def build(path: Path = OUT) -> Path:
    doc = BaseDocTemplate(
        str(path), pagesize=letter,
        leftMargin=0.8 * inch, rightMargin=0.8 * inch,
        topMargin=0.75 * inch, bottomMargin=0.85 * inch,
        title="Milestone 6 - observation sheet",
        author="EZslicer3D", subject="Watching someone print, without you")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body")
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=decorate)])
    doc.build(story())
    return path


if __name__ == "__main__":
    print(f"wrote {build()}")
