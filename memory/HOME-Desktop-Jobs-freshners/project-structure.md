---
name: project-structure
description: The site was reorganised on 2026-11-02 for hand-over; older memories quote paths that no longer exist
metadata:
  type: project
---

The user asked for a real structure any developer can work in without AI. Code is now in src/app, src/components (layout, sections, drive, card, scent, ui), src/content (all words, prices and lists), src/lib and src/styles (one stylesheet per part, order set in site.css). Images are in public/brand, clients, drive, samples, scent and sections. Scripts stay beside the art they read, in scripts/drive, paint, samples, logos, images, source-art and retired.

**Why:** the user is handing the site on. Docs: docs/STRUCTURE.md, docs/HOW-TO.md, docs/FILE-TREE.md (npm run tree), scripts/README.md.

**How to apply:** keep the docs true when moving files, and put new content in src/content, not in components. Paths in [[brand-direction]] such as design.ts, b2b.css, public/b2b and scripts/brand are the old names: map them via docs/STRUCTURE.md. scripts/ images are gitignored, so they travel as a zip.
