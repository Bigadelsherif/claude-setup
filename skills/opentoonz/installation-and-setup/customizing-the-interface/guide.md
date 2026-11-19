# Customizing the Interface (OpenToonz 1.7)

OpenToonz organizes its workspace into **rooms** — tabbed layouts listed on the far right of the menu bar. Click a tab to switch rooms, double-click one to rename it, or drag tabs to reorder them. Right-click the tab area and choose **New Room** to add a blank workspace, or right-click an existing tab and pick **Delete Room** to remove it (you can't delete the one you're currently in).

Once inside a room, resize any pane by dragging the separators between them. To add a pane, open it as a floating window from the **Windows** menu, then drag its title bar into the room until a highlight shows the docking point — release to snap it in. Removing a pane is the reverse: drag its title bar out to undock, then close the floating window. Double-click a pane's title bar to maximize it (or restore it if already maximized).

When your layout is dialed in, lock it with **Windows → Workspace → Lock Room Panes** so you don't accidentally rearrange things mid-session. If you ever need a fresh start, **Windows → Workspace → Reset to Default Rooms** brings back the factory layout.

The **Command Bar** (open it via **Windows → Command Bar**) gives you quick-access buttons for your most-used tools. Right-click it and choose **Customize Command Bar** to drag commands in from the toolbar items list, add separators, or remove buttons you never touch.

To change the interface language or theme, head to **File → Preferences… → Interface**. Pick your language (English, German, Spanish, French, Italian, Russian, Japanese, or Chinese) and restart OpenToonz. For the visual theme, choose from Default, Blue, Dark, Light, or Neutral — no restart needed. You can even create your own theme by duplicating an existing folder in `OpenToonz stuff/config/qss`, renaming it, and editing the QSS file and PNG assets inside.

---

## UI Reference  —  Workspace Room Tabs

_Scope: Room tabs (Drawing through Browser), Lock Rooms Tab, Reset Position, right-click New Room context menu_

Nine room tabs in the upper-right portion of the window switch between pre-configured workspace layouts. A Lock icon and a Reset Position button sit at the far right end of the tab strip.

## Layout

The room tabs form a horizontal row that begins roughly at the horizontal midpoint of the window and extends to the right edge. They sit on the same line as the menu bar but are right-aligned. Each tab is a text-labeled button; the currently active room tab is highlighted. To the right of the last tab (Browser) is a small lock icon, and below the tab strip at the far right is a text button labeled "Reset Position."

## Rooms (left to right)

- **Drawing** (1st, default) — Main viewer occupies the centre-left. Cleanup Palette colour editor and Level Strip are docked on the right. Xsheet/Timeline strip runs along the bottom.
- **Cleanup** (2nd) — Wide viewer fills most of the screen. Cleanup Settings (Global) panel on the right shows scan/cleanup parameters: Autocenter, Field Guide, Rotate, Flip, Line Processing, Antialias, Sharpness, Despeckling, Brightness, Contrast.
- **Palette** (3rd) — Cleanup Palette editor (Color/Settings tabs, hexagonal picker, H/S/V/A sliders, Level Palette) docked on the left; Viewer and Xsheet in the centre; Studio Palette (Global Palettes, Project Palettes) on the right.
- **InknPaint** (4th) — Large viewer on the left (~60% width). Color Model viewer with playback controls and Level Palette on the right middle. Level Strip thumbnail column on the far right.
- **Animation** (5th) — Viewer top-left, Xsheet top-centre, Level Strip top-right. Function Editor (curve graph with From/To/Step/Interpolation/Apply) bottom-left. Stage Schematic node graph (Table and Camera1 nodes) bottom-right.
- **Schematic** (6th) — Viewer top-left. Function Editor plus Stage hierarchy tree (Stage / Camera1 / Table / FX) top-right. FX Schematic node graph (XSheet → Output) fills the bottom half, with FX/Stage toggle buttons.
- **Xsheet** (7th) — Xsheet spreadsheet fills the left ~60% showing many columns and all frame rows. Viewer on the right ~40%. Function Editor and Stage tree in the bottom-right panel.
- **Tasks** (8th) — Full-panel task queue manager with toolbar buttons: Start, Stop, Add Render, Add Cleanup, Save, Save As, Load, Remove. Task queue tree below.
- **Browser** (9th, last tab) — File Browser in the top pane with folder tree (My Computer, My Documents, Desktop, Library, History, Project root, sandbox subfolders) and detail list (Name, Type, Frames, Size, Dates) plus navigation buttons (Back, Forward, Up, New, Icon/List, Export File List). Scene Cast panel in the bottom pane.

## Controls

- **Lock Rooms Tab** — Small lock icon immediately after the Browser tab at the far right of the tab strip. Toggles locking of panel panes within the current room (equivalent to Windows > Workspace > Lock Room Panes).
- **Reset Position** — Text button below the tab strip at the top-right corner. Resets the panel layout positions within the active room to their defaults.
- **Right-click on any room tab** — Context menu with a single item: "New Room" to create a custom workspace.

