// ABANDONED 2026-09-12 -- not published, do not publish. The customizer does not
// run in Bambu Handy, which was the point. See docs/transport-findings.md §A4c.
// Kept as the record of what was measured, not as work in progress.
//
// Print Anything -- bring your own STL.
//
// Published on MakerWorld as a Parametric Model Maker script. The reader
// uploads their own part; this page sizes, turns and lifts it, and hands back
// something they can print from a phone or tablet.
//
// It does those three things and nothing else, on purpose. Every extra
// operation -- a base cut, a wrapper, anything that subtracts -- means running
// a solid-geometry engine against a mesh this page has never seen, usually not
// watertight and often 200k triangles. That is the single most likely way to
// turn a working page into one that times out on a stranger's file.
//
// Why the starter cylinder exists: an unset "default.stl" is not empty.
// MakerWorld fills it with a placeholder of its own -- a flat Bambu logo --
// so a page whose only geometry is import(part_file) opens on somebody else's
// branding, and that is also the picture the listing gets. The cylinder is
// the page's own opening shape, and `use_uploaded_part` swaps to the reader's
// file. Turning the switch on is what turns the cylinder off; they are never
// both on the plate, so nothing here has to arrange two objects.
//
// What it cannot do, and no version of it can: OpenSCAD cannot measure a mesh
// it imported. There is no bounding box, no list of parts, no footprint. So
// this page cannot lay a part flat for you, cannot split one too big for the
// bed, and cannot tell the reader either has happened. Say so on the listing.
//
// resize() is the exception and the reason "Exact width" exists at all -- it
// scales to an absolute measurement without anything here knowing the number.
// VERIFY IT ONCE before publishing: upload a 20 mm cube, set Exact width to
// 40, generate, and measure what comes back. Wrong-size output is the worst
// failure this page could have, and it is the one thing here never run.
//
// Keep every parameter description to ONE line. Handy shows only the last line
// of a multi-line comment, so a two-line note arrives as a fragment starting
// mid-sentence. Measured 2026-09-12, docs/transport-findings.md §A4b.

/* [Your part] */

// Your own STL file. Very large files may not build.
part_file = "default.stl";

// Tick this once your file is uploaded. Until then you get the plain cylinder.
use_uploaded_part = false;

/* [Starting shape] */

// Only used until you tick the box above. Width across, in millimetres.
starter_width_mm = 40; // [5:1:200]

// Only used until you tick the box above. Height, in millimetres.
starter_height_mm = 20; // [1:1:200]

/* [Size] */

// Percent keeps your file's proportions. Exact width pins one measurement.
size_mode = "Percent"; // [Percent, Exact width]

// Used when size is set to Percent.
scale_percent = 100; // [10:5:300]

// For Exact width: millimetres left to right, measured before any turning.
width_mm = 100; // [10:5:250]

/* [Turning] */

// Tip forward or back, in degrees, if your file stands on the wrong face.
turn_x = 0; // [0:15:345]

// Tip the part left or right, in degrees.
turn_y = 0; // [0:15:345]

// Spin the part flat on the plate, in degrees.
turn_z = 0; // [0:15:345]

/* [Height] */

// Raise off the plate, in millimetres, if turning sank it. Check the preview.
lift_mm = 0; // [0:1:50]


// Size first, in the file's own frame, then turn, then lift. Sizing before
// turning is what makes "Exact width" mean a measurement the reader can take
// off their own file rather than one that changes every time they rotate it.
translate([0, 0, lift_mm])
    rotate([turn_x, turn_y, turn_z])
        sized()
            shape();

// One or the other, never both. The starter is a real printable object rather
// than a token, so the page's default state is something somebody could send
// to a printer as it stands -- which is also what the listing photo shows.
module shape() {
    if (use_uploaded_part)
        import(part_file);
    else
        cylinder(h = starter_height_mm, d = starter_width_mm, $fn = 96);
}

module sized() {
    if (size_mode == "Exact width")
        // A 0 with auto = true means "scale this axis to match", so the part
        // keeps its proportions and only the width is pinned.
        resize([width_mm, 0, 0], auto = true) children();
    else
        scale(scale_percent / 100) children();
}
