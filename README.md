# Oathsworn: Into the Deepwood - Web Companion App

A browser-based companion for the board game [Oathsworn: Into the Deepwood](https://shadowborne-games.com/oathapp) by Shadowborne Games. It recreates the full in-app gamebook experience — chapter navigation, section text, narration audio, popup instructions, location tracking, time tracking, and more — accessible in any browser without needing a phone or Android emulator.

**This repo contains no copyrighted game content - not from the game or the app.**
All assets (audio, images, story text) are generated locally from the official game APK on your own machine and are never stored in this repository.

Getting the official APK to work on anything other than Bazzite + Waydroid was a huge pain for me (and it appears others).
Thus: let's make a web app.

---

## Getting the app without building

The `main` branch is always kept in a working, releasable state. If you just want
to get the latest version, cloning the repo directly is equivalent to downloading
the newest release:

```bash
git clone https://github.com/TheTacoScott/oathsworn-webapp.git
cd oathsworn-webapp
./setup.sh
```

You can also `git pull` at any time to update without re-cloning.

---

## Quick start (Docker)

**Prerequisites:** Docker + Linux (Some kind of linux-ish environment like MacOS or maybe even Windows with WSL should™ work)

```bash
./setup.sh
```

This builds a container with jadx bundled, downloads the APK from Google Drive, validates it, decompiles it, and writes a ready-to-open web app to `./web/` on your host. When it finishes, open `web/index.html` in a browser.

The downloaded APK is cached in `./cache/` so repeated runs skip the download. Set `APK_CACHE` to use a different location:

```bash
APK_CACHE=~/.cache/oathsworn ./setup.sh
```
You can delete the APK after the process is finished.

To write the web output to a different directory:
```bash
./setup.sh /path/to/output    # opens as /path/to/output/index.html
```

---

## Features

### Setup pipeline
- One-command setup via `./setup.sh` (requires Docker)
- Downloads the official APK from Google Drive and validates it with SHA256
- Decompiles the APK using jadx, extracts all story text, audio, and images
- Generates a fully self-contained web app in `./web/` — no server needed, just open `index.html` in a browser
- APK is cached locally so repeated runs skip the re-download

### All 22 chapters supported
- All 21 numbered chapters plus Chapter 11.5
- Correct handling of two-path chapters (2, 5, 7, 9, 15) where the story splits into path A and path B
- Correct handling of Deepwood exploration chapters (4, 10, 14, 17, 18) with time token mechanics

### Gamebook experience
- Full section text and popup/event text displayed in reading order
- Chapter and section images displayed inline, capped to preserve proportions
- Image lightbox: click any image to zoom in full-screen; click or press Escape to close
- Hover highlight on images to indicate they are clickable
- Story choices and location buttons rendered at the bottom of each section
- Location buttons display the time token icon

### Audio narration
- Full narration audio for all sections that have it
- Multi-track support: sections with multiple audio clips show a track label and Prev/Next buttons
- Auto-play next track: when one track ends, the next plays automatically (configurable)
- Auto-start narration: audio begins playing when a new section loads (configurable)

### Auto-scroll
- Automatically scrolls through the story text in sync with narration
- Pauses when you scroll manually; a tap-to-resume bar appears at the bottom
- Auto-scroll can be disabled in settings

### Time tracking
- Tracks cumulative time spent in each chapter
- Fires time-triggered story events and journal entries at the correct time values
- Correctly handles path-conditional time triggers (different redirects for path A vs path B players)

### Location tracking
- Tracks discovered locations and displays them as navigable buttons
- Supports adding, removing, and clearing locations as the story dictates

### Progress and saves
- Game progress saved automatically in browser localStorage per chapter
- Resume a chapter exactly where you left off
- Replay a completed chapter from the beginning (fully resets all chapter state)
- Chapter select screen shows In Progress / Completed status per chapter

### Chapter select screen
- Split-pane layout: chapter list on the left, detail panel on the right
- Chapter art and tagline shown in the detail panel
- Scroll indicators on the chapter list when there are more chapters above or below

### Settings
- Persistent settings saved across sessions
- Toggle auto-scroll on/off
- Toggle auto-start narration on/off
- Toggle auto-play next audio track on/off

### Scroll indicators
- Gradient overlay indicators on the choice/location button area when options are hidden off-screen
- Gradient overlay on the story text area that fades with scroll position
- Scroll indicators on the chapter list

### Bug reporting
- Built-in bug report button that captures current section, chapter, and full save state
- Pre-fills a report ready to copy and paste into a GitHub issue
