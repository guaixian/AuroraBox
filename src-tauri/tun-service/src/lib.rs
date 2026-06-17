#![cfg(target_os = "windows")]
#![allow(dead_code)]

pub mod dns;
pub mod scm;
pub mod service;

pub const SERVICE_NAME: &str = "AuroraBoxTunService";
pub const SERVICE_DISPLAY_NAME: &str = "AuroraBox TUN Service";
pub const SERVICE_DESCRIPTION: &str =
    "Runs sing-box in TUN mode on behalf of AuroraBox. Installed once per machine; started on demand without UAC.";
