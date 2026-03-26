# Oathsworn: Into the Deepwood - Web Companion App

A browser-based companion for the board game [Oathsworn: Into the Deepwood](https://shadowborne-games.com/oathapp) by Shadowborne Games. It recreates the in-app gamebook experience: chapter navigation, section text, narration audio, popup instructions, location tracking, and time tracking.

**This repo contains no copyrighted game content - not from the game or the app.**
All assets (audio, images, strings) are generated locally from the official game APK on your own machine and are never stored in this repository.

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
