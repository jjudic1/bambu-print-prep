# Print Anything -- the MakerWorld listing

Copy for the model page that publishes `print-anything.scad`. Kept here rather
than only on MakerWorld for the same reason the guide pages are committed:
copy that exists in one place nobody proof-reads goes stale and nobody notices.

The §6 jargon ban does **not** apply here. "STL" and "slice" are the words
people type into a search box, and a listing avoiding them cannot be found by
the person looking for it -- the same exemption `web/guides.mjs` takes.

---

## Title

> Print Anything - upload your own STL, print from your phone or tablet

## Summary

> No computer needed. Upload any STL, set the size, and print it straight from
> Bambu Handy.

## Description

> ### What this is
>
> A blank page for your own files. Upload an STL, set how big you want it, and
> this hands you something you can print -- no slicer, no laptop, no desktop
> software at all. It is meant for anyone whose only device is a phone or a
> tablet.
>
> ### How to use it
>
> 1. Tap **Customize** and upload your STL under **Your part**.
> 2. Set the size. **Percent** keeps your file's own proportions. **Exact
>    width** lets you type a measurement in millimetres and scales the rest to
>    match.
> 3. If your part arrives lying on the wrong face, use the **Turning** sliders.
>    Watch the preview -- if turning pushes part of it below the plate, raise
>    **Lift** until it sits on top.
> 4. Tap **Generate**, then print it from Bambu Handy.
>
> ### What it will not do
>
> Being straight with you, because finding out at the printer is worse:
>
> - **It cannot lay your part flat for you.** It turns your part by the amounts
>   you choose and it cannot see the result, so checking it sits properly on
>   the plate is yours to do in the preview.
> - **It cannot split a part that is too big for your bed.** One part, one
>   plate. If your model does not fit, this page cannot help -- see below.
> - **One STL at a time**, and it has to be an STL. Not a 3MF, not a STEP.
> - **Very large files may not build.** If nothing appears after Generate, the
>   file was too heavy. Try a simpler one.
>
> ### Too big for your bed?
>
> If your part does not fit, [Handoff3D](https://bambu-print-prep.vercel.app)
> is a free web page that splits a model into pieces that do and arranges them
> across plates for you. It runs on the device you are holding. Made by the
> same person as this page.
>
> ### The print in the photos
>
> [Say what it is and what it was printed on.]

## Tags

`utility` `no computer` `ipad` `iphone` `tablet` `stl` `upload your own`
`beginner` `parametric` `handy`

---

## Before publishing

The listing is the easy half. These are the things that make it a real model
rather than a thin one, and the last is the one that actually matters.

1. **Print something through it and photograph the result.** MakerWorld's terms
   require a photo of the real thing to go public, and a utility listing with
   no printed photo is exactly what reads as low effort. This is also the only
   honest way to write "The print in the photos".
2. **Check `resize()` before anyone else does.** Upload a 20 mm cube, choose
   Exact width, set 40, generate, download, measure. Wrong-size output is the
   worst failure this page has and it is the one thing never run here.
3. **Find the ceiling.** Generate with a real export at full density -- 150k
   triangles or so. If it times out, either say so in the listing with a rough
   limit, or drop the "very large files" line for something specific.
4. **Test it in Handy, not just Safari.** §A4 measured Safari against
   MakerLab's editor. The published customize form inside Handy's in-app
   browser is a different screen in a different browser, and it is the one
   every reader will actually use. Publish private, open it in Handy, upload
   from the iPad.
5. **Keep it private until 1-4 are done.**
