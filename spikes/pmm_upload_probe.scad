// Does an iPad running Bambu Handy get to hand a file to MakerWorld's
// Parametric Model Maker at all?
//
// This is a measurement, not a model. Nothing here is meant to be published.
// Post it PRIVATE on the Handoff3D MakerWorld account, open it in Handy on the
// iPad, and try to pick an STL out of Files. Three outcomes, and each settles
// something we cannot reason our way to from a desktop:
//
//   * The Files browser greys your .stl out. The form carries an `accept`
//     attribute WebKit cannot resolve into a type -- the same trap the app's
//     own file input avoids by having no `accept` at all (see CLAUDE.md, and
//     web/src/local/LocalApp.jsx:817). It is their form, so it is not ours to
//     fix. The route is dead on iOS and the idea stops here.
//   * It uploads and renders. The route exists -- go on to the heavy-file run
//     below before designing anything around it.
//   * It uploads and times out. The route exists but not for real models.
//     Write down the triangle count that broke it.
//
// Two things to get right or the probe measures the wrong thing:
//
//   * The uploaded file MUST arrive as `default.stl`. PMM documents built-in
//     default asset names and nothing else; arbitrary co-uploaded filenames
//     are the documented failure mode, so a rejection under some other name
//     tells us nothing about iOS.
//   * Do NOT add an mw_plate_N() module here. Multi-plate output disables STL
//     download on a script, which is a second variable in a test that has one
//     question.
//
// Second run, only if the first one uploads: repeat with a mesh of roughly
// 150k triangles. PMM has a practical render ceiling and an arbitrary user
// mesh -- not watertight, not simplified -- is the worst case for it. That is
// the run that decides whether this works for models anyone actually has.
//
// Record whatever happens in docs/transport-findings.md, the way the A2 run
// was recorded. A measurement nobody wrote down gets made twice.

/* [Uploaded part] */

// Upload your own part here. It has to be an STL.
part_file = "default.stl";

// Size of the part, as a percentage of the file it came from.
scale_percent = 100; // [10:200]

// Lift the part off the plate, in millimetres, if it sits low.
lift_mm = 0; // [0:20]

/* [Hidden] */
$fn = 48;

// Translate outside the scale, so a millimetre on the slider is a millimetre
// on the plate rather than a millimetre times whatever scale_percent is.
translate([0, 0, lift_mm])
    scale(scale_percent / 100)
        import(part_file);
