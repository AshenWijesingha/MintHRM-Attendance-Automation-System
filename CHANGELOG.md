# Changelog

All notable changes to the MintHRM Attendance Automation System are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.1.0] - 2026-11-26

### Added
- Downloadable, ready-to-install package (`minthrm-attendance-automation.zip`) published with every GitHub Release, with SHA-256 checksums.
- `scripts/build.sh` to build the package locally and `scripts/validate.mjs` to check the manifest, referenced files, icon sizes and JavaScript syntax before packaging.
- GitHub Actions workflow that validates and builds on every push and publishes releases from version tags or a manual run.
- Project homepage link in the extension's details page.

### Changed
- Extension description shortened to fit the 132-character Chrome Web Store limit.
- README rewritten with installation, usage, configuration, troubleshooting and release instructions.

### Features in this version
- Floating panel (Shadow DOM, draggable, minimisable to a pill) on **Self → Manage My Attendance**.
- **Submit** tab: In/Out times, reason picker, **Preview** (dry run) and **Fill & Submit All** with progress bar, Submitted / Skipped / Failed counters, filterable log and *Copy log*.
- **Reasons** tab: add, rename, delete and star a default reason; saved in browser storage.
- **Options** tab: date range with quick picks, keep real fingerprint punches, skip holidays & leave days, adjustable pause between steps, reset to defaults.
- Always skips off days ("No shift listed") and days that already have a pending change request.

[Unreleased]: https://github.com/AshenWijesingha/MintHRM-Attendance-Automation-System/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/AshenWijesingha/MintHRM-Attendance-Automation-System/releases/tag/v2.1.0
