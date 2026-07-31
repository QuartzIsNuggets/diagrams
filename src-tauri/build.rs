// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

use std::fs::{File, create_dir_all};
use std::io::BufWriter;
use std::path::Path;

/// Where the generated window icon lands: under `gen/`, so it is not committed.
///
/// In the source tree rather than `OUT_DIR`, which is where a build script is
/// otherwise meant to write — forced, because Tauri resolves `bundle.icon`
/// relative to the config and cannot be pointed at a hashed build directory.
const WINDOW_ICON: &str = "gen/window-icon.png";

fn main() {
    write_blank_window_icon();
    tauri_build::build();
}

/// Write the blank PNG Tauri insists on having as a window icon.
///
/// `tauri::generate_context!` resolves a window icon at compile time and fails
/// the build when the file is missing; on Unix there is no configuration that
/// declines one. This project has no icon and wants none yet — nothing is
/// bundled, and Tauri's placeholders are Tauri's own logo, which this
/// repository cannot claim as its work. A single transparent pixel says that
/// honestly, and generating it keeps a stand-in asset out of the tree.
fn write_blank_window_icon() {
    // Regenerate if it is ever deleted; leave it alone otherwise, so writing it
    // does not invalidate the very timestamp that decides whether to rerun.
    println!("cargo::rerun-if-changed={WINDOW_ICON}");
    let path = Path::new(WINDOW_ICON);
    if path.exists() {
        return;
    }

    let dir = path.parent().expect("the window icon path has a parent");
    create_dir_all(dir).expect("failed to create the generated-icon directory");
    let file = File::create(path).expect("failed to create the window icon");

    let mut encoder = png::Encoder::new(BufWriter::new(file), 1, 1);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .expect("failed to write the window icon header")
        .write_image_data(&[0, 0, 0, 0])
        .expect("failed to write the window icon pixel");
}
