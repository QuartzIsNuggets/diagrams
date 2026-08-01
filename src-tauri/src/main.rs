// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

//! The desktop surface's entry point.
//!
//! It opens a window on the frontend and nothing else. Every capability this
//! surface has beyond the web one comes from a Tauri plugin invoked from
//! TypeScript, so there is no command to register here and no state to hold.
//!
//! Registering a plugin only makes its commands reachable; what the frontend
//! may actually call is `capabilities/default.toml`.

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("failed to start the diagrams window");
}
