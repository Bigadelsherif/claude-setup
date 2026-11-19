# Saving and Exporting Scenes (OpenToonz 1.7)

Every new scene starts life as "untitled" with a number appended. Untitled scenes live in `OpenToonz stuff/projects/temp` — they're deleted if you never properly save, so don't leave work there.

To save everything at once — scene file plus all modified levels — use **File > Save All**. If you only want to save the scene structure without touching levels, **File > Save Scene** does the job. To save a copy under a new name, go **File > Save Scene As…** and pick a location inside your project's *+scenes* folder (or a subfolder of it).

Loading is straightforward: **File > Load Scene…** opens a browser pointed at your project's scenes. You can also right-click a TNZ file in the built-in browser and choose **Load Scene…**, or drag it onto the clapboard icon in the Scene Cast. Recent files are available under **File > Open Recent Scene File**. If something goes wrong, **File > Revert Scene** snaps you back to the last saved version.

For auto-saving, head to **File > Preferences… > Saving**, enable **Save Automatically**, and set your interval in minutes. You can choose whether it covers the scene file, non-scene files, or both.

OpenToonz keeps four backup versions of every saved scene in `+scenes/backups/<scene_name>`. To recover one, rename the backup file (strip the trailing number) and drop it back into the *+scenes* folder.

When you need to move a scene to a different project, select it in the browser, right-click, and choose **Export Scene…**. You can target an existing project or create a new one on the spot — all assets are collected and copied automatically. Going the other direction, loading a scene from another project prompts you to **Import Scene** (copies assets into your current project) or **Change Project**. You can also batch-import scenes without loading them by selecting them in the browser and choosing **Import Scene** from the right-click menu.

If your scene references files from outside the project folders, use **Collect Assets** (right-click selected scenes in the browser) to pull everything into the proper default folders and fix the paths automatically.

---

## UI Reference  —  Load Scene Dialog

_Scope: File > Load Scene dialog: folder tree, file list, File name field, Load/Cancel buttons, navigation quirks_

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

