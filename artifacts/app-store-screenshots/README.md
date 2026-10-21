# Wig App Store screenshots

Six marketing screenshots using the supplied app captures, kept intact inside a consistent dark layout.

Order:
1. Find your next night out — Home
2. Let your friends know — RSVP
3. Keep up with your people — Activity
4. Find your favorite spots — Places
5. Your plans, all together — Upcoming profile
6. Look back at great nights — Past profile

Exports:
- `1320x2868/`: large-display iPhone screenshots.
- `1206x2622/`: medium-display iPhone screenshots matching the source capture size.
- `contact-sheet.png`: overview for review; do not upload this file as an individual product screenshot.

Apple's supported dimensions: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/

Editable source:
- `source/design.html`: layout, typography, and colors.
- `source/frames.json`: image order and headlines.
- `source/assets/`: original supplied screenshots and existing Wig logo.
- `source/render.cjs`: exports PNGs using the installed Playwright and Sharp runtime. Runtime and browser paths are local to this Mac.

The zip contains both export sizes, the contact sheet, and this README. The editable source remains alongside it in this folder.
