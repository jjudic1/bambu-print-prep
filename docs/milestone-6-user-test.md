# Milestone 6 — watching someone print without you

**The only milestone that proves anything, and it has never been attempted.**
Everything else in this repo is measured against files, slicers and benchmarks.
This is the one measurement that cannot be automated, which is why it keeps not
happening.

The goal is **not** to find out whether the app works. It is to find out **where
the person stops**. Those are different questions and only the second one is
useful, because every fix so far has come from a specific failure and not from a
general impression.

---

## The one rule

**Do not help.**

Not a hint, not a nudge, not "try tapping that". The moment you help, the run is
over as evidence — you have replaced the thing being measured with yourself. If
they ask you a question, write the question down and say some version of:

> "Pretend I'm not here. Do whatever you'd do if you were on your own."

If they are genuinely stuck and distressed, stop the session and record it as a
**hard stop**. A hard stop is the most valuable result this test can produce. It
is not a failed session; it is the finding.

The temptation to help will be strong, because you built it and you can see the
button they are missing. That is exactly the data.

---

## Who

One person who:

- has never used this app,
- does not 3D print,
- was not in any conversation about it.

A partner or friend is fine. A colleague who has heard you talk about it is not
— they will know what "plate" means, and that is precisely what is being tested.

**One person is enough for the first run.** Do not line up five. The first
person will hit so many things that running the other four before fixing
anything would be a waste of four people.

---

## Setup, before they arrive

- The printer is on, has filament loaded, and is already paired to Bambu Handy.
- A MakerWorld account exists and is **already signed in on the iPad's Safari**,
  unless you specifically want to test signup — that is a different, longer test
  and it is Bambu's flow, not yours.
- Bambu Handy is installed and signed in to the same account.
- A model file is already saved in the iPad's Files app. **Pick a real one from
  MakerWorld, something with more than one loose part**, so the split button is
  reachable. Do not use a test cube.
- The app is open at the `/local` page. Nothing else is open.
- You have this document, a pen, and a clock.
- **Record the screen** if they consent. You will miss things live.

Set the iPad's autolock to something long. A screen sleeping mid-task is your
bug, not theirs.

---

## What you say

Once. Word for word, then stop talking:

> "This is a thing for printing a 3D model on my printer. There's a file called
> `<name>` in Files. Please make it print. Think out loud if you can."

Then say nothing until they finish or hard-stop.

Do not say: plate, part, orient, mesh, slice, container, upload, MakerWorld, or
Handy. If you name a step, you have taught them the step.

---

## What to record

Two columns, and the second one matters more.

| Time | What they did / said |
|------|----------------------|

Write down **verbatim** anything they say that names a thing differently from
the way the app names it. "The thingy", "the picture one", "the printy button" —
those are the app's vocabulary being wrong, and they are the cheapest fixes you
will ever get.

Mark each of these when it happens:

- **P** — a pause longer than about ten seconds with no action.
- **W** — a wrong turn: they did something and had to undo it or go back.
- **Q** — they asked you a question (write the question).
- **X** — hard stop.

---

## Where the evidence says they will stall

Predictions, so that you notice them rather than reconstruct them afterwards.
**A prediction that does not happen is as useful as one that does** — it means
attention is going to the wrong place.

1. **Getting started at all.** The landing page is one button. Watch whether
   they find the file in Files, and whether the Files picker shows the model or
   greys it out. `accept` on the file input made iPads refuse every file once;
   it is gone, and it must not come back.

2. **Three files at the end.** The output is now the model, a picture, and a
   how-to page. This is *new and untested on a person*. Watch whether they save
   all three, whether they can tell which is which, and whether they ever open
   the how-to page at all. If they ignore it, the instructions are not
   instructions — they are a file nobody opens, and the whole §6.5 premise needs
   rethinking.

3. **The photo, at MakerWorld.** The known worst step. MakerWorld will not
   accept our render and demands a real photo. The how-to page warns about this
   in step 4. Watch whether they read it, believe it, or grind against the
   upload form first. Predicted: a long pause and a Q.

4. **Private.** If they miss it, the model is public. Note it and do not correct
   it during the run — fix it afterwards yourself.

5. **Finding it in Bambu Handy.** Two routes exist, and the fallback exists
   because the short one is easy to miss. Watch which route they take, and
   whether the how-to page's wording matches what Handy actually shows them
   *today* — Bambu ships app updates and that copy was verified on 2026-08-23.

6. **Colour.** New confusion, introduced deliberately and worth watching. The
   app lets them colour parts, but the colour is only a picture — the printer
   uses whatever filament is loaded. If they pick blue in the app and expect blue
   out of the printer, that is a real expectation mismatch and it is ours. The
   panel says so in words; find out whether words are enough.

7. **Size.** Watch whether "Keep its shape" means anything to them, and whether
   they ever notice the model is bigger than the bed. The bar turning red is the
   only signal.

8. **Split.** Predicted: they never touch it, because nothing tells them to.
   Splitting is the answer to "too big for the bed", and the app does not
   currently connect the problem to the button. If they hit the bed limit and do
   not find Split, that is a finding worth more than the button was.

---

## What counts as done

**Done = the printer is printing.** Not "they got to Handy", not "the file
uploaded". Filament moving.

Record:

- **Time to printing**, wall clock, from your one sentence.
- **Q count** — every question they had to ask.
- **X** — where they hard-stopped, if they did.

There is no target number. The first run establishes the number; later runs are
measured against it.

---

## Afterwards

Ask these three, in this order, and write the answers down before discussing
anything:

1. "Talk me through what you thought was happening, at each point."
2. "Was there a moment you thought it had gone wrong?"
3. "If you had to do it again tomorrow, what would you dread?"

Then, and only then, you can explain anything they ask about.

**Do not fix anything for at least a day.** The urge after watching will be to
patch the specific button they missed. Most of what you saw will be one or two
underlying problems wearing several costumes, and you can only see that once the
sting has worn off. Write the findings down first; decide second.

Findings go in `docs/HANDOFF.md` under a new heading, with the same standard as
everything else in this repo: what was observed, not what it means.

---

## What this test is not

- Not a demo. If you find yourself presenting, stop.
- Not a usability score. One person is not a sample; it is a flashlight.
- Not a test of MakerWorld or Bambu Handy. Those will produce failures you
  cannot fix. Record them anyway — §2A's whole delivery loop rests on them, and
  "the thing we depend on is the thing that broke" is a product finding even
  when it is not a code fix.
