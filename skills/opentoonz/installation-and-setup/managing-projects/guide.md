# Managing Projects (OpenToonz 1.7)

Projects give every scene in a production consistent settings and a shared folder structure. When you create a scene inside a project, it automatically inherits the project's defaults — and files like scanned drawings land in the right place without manual filing.

**The projectroot** is where OpenToonz stores all project databases. On Windows, edit the registry key at `HKEY_LOCAL_MACHINE\SOFTWARE\OpenToonz\OpenToonz` → double-click TOONZPROJECTS and set your path. On Mac, right-click the OpenToonz app → **Show Package Contents**, then edit `Contents/Resources/SystemVar.ini`. Separate multiple roots with a semicolon. Restart OpenToonz after any change.

To create a project, go to **File → Project Management → New Project…**, pick a projectroot, name your project, and configure the default folder paths. Each alias — **+inputs**, **+drawings**, **+scenes**, **+extras**, **+outputs**, **+palettes** — points to where that category of file lives. Paths can be absolute (e.g., `C:\production\drawings01`) or relative to the project folder.

To switch projects, click the small round indicator beside the project name in the file browser — it turns red when active. Any new scene you create via **File → New Scene** belongs to whichever project is current. Adjust existing folder paths anytime through **File → Project Management → Project Settings…**, but be aware older scenes may lose track of their files.

The `$scenepath` variable is powerful for per-scene organization. Place it in a folder definition (like `$scenepath\mydrawings`) and OpenToonz auto-creates scene-specific subfolders when you save. Alternatively, tick **Append $scenepath** in the New Project dialog to append the scene's save-path to the alias automatically — you can't use both methods on the same alias.

For custom aliases beyond the built-in six, edit `OpenToonz stuff/profiles/project_folders.txt` — list one folder name per line. In the project browser, folders targeted by aliases appear in blue, giving you quick access to production material regardless of where it physically lives on disk.

---

## UI Reference  —  Load Scene Dialog

_Scope: Left tree panel showing Project root and project subfolders; project browser navigation_

The file browser dialog opened by File > Load Scene... (Ctrl+L). Used to navigate to and open `.tnz` scene files.

## Layout

The dialog is a modal window centred over the main canvas. Its title bar reads "Load Scene." Immediately below the title bar is a toolbar row of seven navigation and view buttons. Below that is the Folder path bar showing the current directory. The main body is split into two panels: a left tree panel (~40% width) with shortcut locations, and a right file list panel (~60%) showing directory contents. At the bottom is a footer with a File name text field and Load/Cancel buttons.

## Elements

### Toolbar (top row, left to right)
**Back** (left arrow, navigates to previously visited folder), **Forward** (right arrow, navigates forward in history after using Back), **Up One Level** (up arrow, goes to parent directory), **New Folder** (creates subfolder), **Icons View** (switches right panel to large thumbnail grid), **List View** (switches to detail table — the default), **Export File List** (exports folder contents as a list file).

### Folder path bar
Editable text field below the toolbar displaying the current directory path. Click to focus, Ctrl+A to select all, type an absolute path, press Enter to navigate. The right panel updates immediately. This is the correct and reliable way to navigate to any arbitrary directory.

### Left tree panel
Hierarchical shortcut tree with the following top-level entries:
- **My Computer** — Expands to show the filesystem root `/` and all top-level system directories. Clicking the label toggles the subtree but does not navigate the right panel; click the `/` child node or use the right panel to navigate.
- **My Documents** — Single-click navigates to the user's Documents directory.
- **Desktop** — Single-click navigates to the user's Desktop directory.
- **Library** — Navigates to the OpenToonz library folder (clapperboards, custom styles, mypaint brushes, particles, shaders, textures, vector brushes).
- **History** — Expand arrow shows recently visited paths; empty in fresh sessions.
- **Project root** — Navigates to the OpenToonz projects directory.
- **sandbox** (red dot icon = active project) — Navigates to the current project root; expands to show subfolders: drawings, extras, inputs, outputs, palettes, scenes, scripts.

### Right file list panel
- **List View** (default): Table with columns Name, Type, Frames, Size, Date Created, Date. Click a column header to sort ascending; click again for descending. A triangle indicator (▲/▼) marks the active sort column.
- **Icons View**: Large thumbnails; `.tnz` files show rendered first-frame previews with frame count in brackets (e.g. `dwanko_run.tnz [72]`).
- **Single-click** on a directory navigates into it immediately (double-click also works but is redundant).
- **Single-click** on a `.tnz` file populates the File name field but does not load.
- **Double-click** on a `.tnz` file loads the scene and closes the dialog.
- **Right-click** anywhere: context menu with Show Folder Contents and Select All (Ctrl+A).

### Footer
- **File name field** — Bare filename only. Automatically populated when a file is single-clicked. **Do NOT type absolute paths here** — OpenToonz strips the leading `/` and concatenates with the Folder path, producing an invalid path and a "does not exist" error.
- **Load button** — Opens the file at `Folder + "/" + File name`. Also triggered by pressing Enter.
- **Cancel button** — Closes without loading. Also triggered by Escape.

## Important Quirks

- The dialog remembers its last-visited folder within the same session; it does not reset to the project scenes folder each time it opens.
- The left tree does not highlight the current folder when navigating via the Folder text field.
- Single-click (not just double-click) navigates into directories in the right panel.
- Sorting does not pin directories above files — they interleave when sorted by a non-Name column.

---

## UI Reference  —  Startup Dialog

_Scope: Current Project dropdown, New Project button, Save In path for scene location_

The OpenToonz Startup dialog appears on application launch, offering scene creation, project selection, and recent-scene access. It is a modal dialog centred over the main workspace.

## Layout

The dialog's title bar reads "OpenToonz Startup" with a close (X) button at the top right. The body is divided into a left panel and a right panel. The left panel has the OpenToonz logo and branding at the top, then project/scene creation controls. The right panel shows recent scenes. A bottom strip spans the full dialog width with a checkbox and an auto-save field.

## Elements

### Left Panel — Create a New Scene
- **Current Project** dropdown (default: sandbox) — Selects the project context.
- **New Project...** button — Right of the dropdown; opens a project creation dialog.
- **Scene Name** field — Text input for the new scene filename. Required before clicking Create Scene.
- **Save In** path field + **"..."** browse button — Shows the save destination directory. WARNING: typing an absolute path here causes OpenToonz to prepend the project folder, creating an invalid path. Use the "..." browse button instead.
- **Camera Size** dropdown — Scrollable list of ~23 presets ranging from UHD 4K (3840x2160) down to various Cineon formats. **Add** and **Remove** buttons to the right for managing custom presets.
- **Width** field (default: 16") and **Height** field (default: 9") — Physical camera dimensions in the selected unit.
- **Resolution** X field (default: 1920) and Y field (default: 1080) — Pixel resolution.
- **Units** dropdown (default: inch) and **DPI** field (default: 120).
- **Frame Rate** field (default: 24).
- **Create Scene** button — Creates the scene with the specified settings and closes the dialog.

### Right Panel — Recent Scenes
- Headed "Recent Scenes [Project]". Shows recently opened scenes for the current project, or "No Recent Scenes" for a fresh project.
- **Open Another Scene...** button — Opens the Load Scene file-browser dialog on top of the Startup dialog.

### Bottom Strip
- **Show this at startup** checkbox (checked by default) — Controls whether the dialog appears on next launch. Uses positive phrasing (not "Don't show again"). There is no menu item to reopen this dialog mid-session.
- **Automatically Save Every [N] Minutes** field (default: 15).

## Important Notes

- The dialog only appears on application launch. File > New Scene (Ctrl+N) does NOT show this dialog — it creates a scene directly.
- When "Open Another Scene..." opens the Load Scene dialog, the Startup dialog's X button is covered and cannot be clicked. Close the Load Scene dialog first (via its Cancel button or its own X), then the Startup dialog becomes accessible again.
- Escape closes whichever dialog currently has focus (Load Scene first if it is on top, then the Startup dialog).

