/**
 * The guided handoff (§6.5), in the browser.
 *
 * A port of prep/handoff.py, and a port is a second copy of knowledge that was
 * expensive to acquire: this copy is not invented, it is the loop performed and
 * verified end to end on 2026-08-23 (docs/transport-findings.md §A2), including
 * both routes through Handy because the short one is easy to miss. Two copies
 * drift, so tests/test_web_handoff.py diffs them on every run.
 *
 * Why a file rather than a screen: the user has to leave the app, do several
 * things in Safari and finish in Bambu Handy, and every one of those is a place
 * they quit. The page sits in Files next to the model -- persistent, not a
 * modal -- and it is self-contained, one HTML file with the picture inlined, so
 * it survives AirDrop, iCloud Drive and mail without any of them stripping half
 * of it.
 *
 * §6.5's copy rules apply to every string here: never "3mf", never "slice",
 * never "mesh". The file has a name, and that is what it gets called.
 */

/** Home page, not a guessed upload path -- a 404 is worse than a sentence. */
export const MAKERWORLD_URL = 'https://makerworld.com'

export const HONEST_FRAMING =
  'This part is clunky, and it is not you. Bambu does not let other apps talk '
  + 'to your printer directly, so the model has to go up to your own private '
  + 'page first. It is a handful of taps, once per model, and no computer is '
  + 'involved.'

export const FALLBACK_ROUTE =
  "Can't find it? In Handy, open the <b>Me</b> tab. There is a row of things "
  + 'like printing history and print queue -- <b>slide that row to the '
  + 'right</b> until you see <b>My Creations</b>, and your model is in there.'

/**
 * The two things this tool cannot do for anyone: stand next to the printer, and
 * print the thing before it goes public. Both are the user's, and saying so in
 * the app is not enough -- the page is what they still have in front of them
 * when they are actually at the printer, days later.
 */
export const DUTY =
  '<b>You are the one at the printer.</b> Nobody has printed this file '
  + 'before you. Whether these settings suit your machine is yours to check: '
  + 'stay with it for the first few minutes and stop the printer if anything '
  + 'does not look right. Any damage to your printer, or to anything else, is '
  + "your responsibility and not this tool's."

/**
 * Verified in the A2 run: MakerWorld refuses our render as the listing photo,
 * and its rules ask for the real thing. Publishing something nobody has printed
 * is a breach of their terms, not a matter of taste.
 */
export const PUBLISHING =
  '<b>Keep it private until you have printed it.</b> MakerWorld only lets a '
  + 'model be made public once you have printed it yourself and can show a '
  + 'photo of the real thing. Making one public without that photo breaks the '
  + 'terms you agreed to when you signed up.'

// Profile names carry hardware detail the user never chose and cannot act on.
const NOZZLE_SUFFIX = /\s+[\d.]+\s*(?:mm)?\s*nozzle\s*$/i

export const plainPrinter = (name) => (name || '').replace(NOZZLE_SUFFIX, '').trim()

/** Python's html.escape(s, quote=True), character for character. */
function escape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/** Sources here stay ASCII; the page should still read like typography. */
const dashes = (text) => text.split(' -- ').join(' &mdash; ')

function pictureTag(previewBase64) {
  if (!previewBase64) return ''
  return '<img class="shot" alt="What it will look like" '
    + 'src="data:image/png;base64,' + previewBase64 + '">'
}

function steps(fileName) {
  const name = escape(fileName)
  return [
    ['Get the file onto your iPad',
      'Save <b>' + name + '</b> into the Files app, wherever you like -- '
      + 'iCloud Drive or On My iPad both work. If it arrived by AirDrop or '
      + 'e-mail, tap Share and choose <b>Save to Files</b>.'],

    ['Open MakerWorld in Safari',
      'Go to <a href="' + MAKERWORLD_URL + '">makerworld.com</a> and sign '
      + 'in. You only have to sign in once -- it remembers you after that.'],

    ['Upload it',
      'Tap <b>Upload</b>, then <b>Choose file</b>, and pick the file you '
      + 'just saved.'],

    ['Add a picture',
      'MakerWorld asks for a photo here, and it will not take the picture '
      + 'that came with the file. <b>Any real photo from your camera roll</b> '
      + 'gets you through -- the model is private, so nobody else sees it. '
      + 'Once it has printed, come back and swap in a photo of the real '
      + 'thing.'],

    ['Set it to Private, then Publish',
      'Give it any title at all. Set who can see it to <b>Private</b> -- '
      + 'this matters, it keeps the model yours and nobody else sees it. Then '
      + 'tap <b>Publish</b>.'],

    ['Open Bambu Handy and print it',
      'Tap your profile picture, top left, then <b>3D Models</b>. Yours is '
      + 'at the top of the list. Tap it, pick your printer and your colour, '
      + 'and print.'],
  ]
}

const CSS = `
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
.duty { border-left: 3px solid var(--accent); padding: .1rem 0 .1rem 1rem;
        margin: 0 0 1.4rem; color: var(--dim); font-size: .93rem; }
.duty b { color: var(--ink); }
.framing { border-top: 1px solid var(--line); padding-top: 1.4rem;
           color: var(--dim); font-size: .93rem; }
.framing b { color: var(--ink); }
`

function factsBlock(rows) {
  const cells = rows
    .filter(([, v]) => v)
    .map(([k, v]) => '<div><span>' + escape(k) + '</span>' + escape(v) + '</div>')
    .join('')
  return cells ? '<div class="facts">' + cells + '</div>' : ''
}

/** Today, as an ISO date, in the user's own timezone -- matching date.today(). */
function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Build the page. Pure string work, so it stays cheap to test.
 *
 * `preview` is base64 PNG data rather than a path, because there are no paths
 * here -- the picture was rendered a moment ago into a canvas.
 */
export function renderHandoff({
  modelName, fileName, printer, sizeText = '', preview = null, material = '',
  date = null,
}) {
  const body = steps(fileName)
    .map(([head, text]) => '<li><h2>' + escape(head) + '</h2><p>' + dashes(text) + '</p></li>')
    .join('')

  const facts = factsBlock([
    ['File', fileName],
    ['Size', sizeText.split(' - ').join(' — ')],
    ['Printer', plainPrinter(printer)],
    ['Material', material],
  ])

  const title = escape(modelName)
  return (
    '<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>How to print ' + title + '</title>\n'
    + '<style>' + CSS + '</style>\n<main>\n'
    + '<h1>How to print ' + title + '</h1>\n'
    + '<p class="sub">It is ready. Here is how to get it to the printer.</p>\n'
    + pictureTag(preview) + '\n' + facts + '\n'
    + '<ol>' + body + '</ol>\n'
    + '<p class="note">' + dashes(FALLBACK_ROUTE) + '</p>\n'
    + '<p class="duty">' + dashes(DUTY) + '</p>\n'
    + '<p class="duty">' + dashes(PUBLISHING) + '</p>\n'
    + '<p class="framing">' + dashes(HONEST_FRAMING) + '<br><br>\n'
    + 'Keep this page. You will want it again next time &mdash; it is the '
    + 'same steps every time. <b>Prepared ' + (date || today())
    + '.</b></p>\n</main>\n</html>\n'
  )
}
