---
name: ArchMind Redline Studio
description: A systems-design workbench with mineral drafting surfaces, signal-red actions, and teal live-flow cues.
colors:
  primary: "#c4472c"
  primary-hover: "#9f3621"
  selection: "#fbe9e4"
  focus: "#e46649"
  paper: "#eef1ed"
  surface: "#fbfcf8"
  surface-secondary: "#e5eae4"
  surface-raised: "#d7dfd7"
  ink: "#17221d"
  muted: "#59685f"
  line: "#d8dfd8"
  line-strong: "#adb9af"
  healthy: "#147d70"
  warning: "#d97706"
  failure: "#dc2626"
  dark-paper: "#0c1411"
  dark-surface: "#111c17"
  dark-surface-secondary: "#182720"
  dark-surface-raised: "#22362c"
  dark-ink: "#edf4ef"
  dark-muted: "#a4b6aa"
  dark-line: "#293c33"
  dark-line-strong: "#465e51"
  dark-selection: "#351813"
  dark-focus: "#ff8d71"
  dark-healthy: "#55d2bd"
typography:
  display:
    fontFamily: "Syne, sans-serif"
    fontSize: "clamp(2.6rem, 5.6vw, 5.2rem)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  body:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.333333
  technical:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "6px"
  toolbar: "8px"
  panel: "12px"
  studio: "16px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-secondary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  button-ghost:
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  chip-brand:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.primary-hover}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  navigation:
    backgroundColor: "{colors.surface-secondary}"
    rounded: "{rounded.toolbar}"
    padding: "4px"
  architecture-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  studio-canvas:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.studio}"
---

# Design System: ArchMind Architecture Studio

## Overview

**Creative North Star: "Redline & Moss"**

Cool mineral drafting paper, forest-black ink, signal-red actions, and teal data flow create an identity rooted in architecture review: redlines mark decisions while living systems move in green. The canvas is the visual center; restrained panel chrome supports the user's work. The light and moss-black dark themes share the connected-A mark, asymmetric corner geometry, hierarchy, and action language.

Motion explains dependencies, changes, and simulation state. Architecture examples remain explicitly illustrative; measured results and technical metadata retain a clear typographic hierarchy.

**Key Characteristics:**

- Readable technical typography and measured spacing.
- Signal-red actions and selections against mineral surfaces.
- Teal terminals and traffic particles identify live system behavior.
- A connected-A mark and redline rail make the shell recognizable without text.
- Graph-centered composition with contextual tools.
- Meaningful motion with reduced-motion access.

## Colors

Signal red guides actions; tonal mineral layers distinguish canvas, panel, and raised controls. Teal identifies live traffic and healthy system behavior. Frontmatter contains normative values, including theme variants.

### Primary

**Signal Red** attaches to primary buttons, selected states, and architectural redlines. The primary hover token provides darker feedback. Focus tokens make keyboard position visible in each theme. Selection washes identify selected diagram cards and supporting accents.

### Neutral

**Warm Paper / Graphite** provide the application background. Studio surface, secondary, and raised tokens establish tonal layers. Ink carries primary text; muted tokens carry descriptions. Drafting lines divide panels and outline controls; stronger lines support actionable boundaries.

### Semantic states

Healthy, warning, and failure colors appear with labels, icons, findings, or numbers so color never supplies the only explanation. Component kind uses restrained cool chips with icons and names.

**The Redline Rule.** Attach signal red to actions, selection, focus, and reviewed changes. Reserve teal for live flow and healthy system behavior.

## Typography

**Display Font:** Syne, sans-serif fallback. **Body Font:** IBM Plex Sans, sans-serif fallback. **Technical Font:** IBM Plex Mono, monospace fallback.

Display type provides identity and large landing statements. Plex Sans supports compact workbench text; Plex Mono identifies measured values and technical metadata. Normative role samples appear in frontmatter. Landing introductory text increases to 16–18px; node names stay around 14px. Labels and badges remain compact, with uppercase reserved for short metadata.

**The Measurement Rule.** Use mono for actual values and technical identifiers, with tabular numbers where values update or align.

## Layout

The application occupies dynamic viewport height. From the small breakpoint, a 12px outer inset and rounded frame separate the workbench from its background. The header is 56px high.

The landing container is capped at 1440px. Horizontal padding progresses from 20px to 40px to 64px. At the large breakpoint, headline and introduction form an asymmetric two-column composition above the full-width drafting demonstration. The demonstration scrolls horizontally on narrow screens to keep its graph legible.

The editor uses a resizable workspace beside a flexible canvas, with history collapsed initially. Below 1024px, labeled navigation shows one workbench panel at a time. The simulation dock wraps inside the canvas. Panel content scrolls within its own bounds; controls should not overlap the graph.

## Elevation & Depth

Tonal layering and fine borders establish hierarchy. Soft and raised shadow tokens have separate light and dark values in globals.css; exact values are recorded in the sidecar. Soft shadows support buttons and canvas controls. Raised shadows support hovered graph cards and floating surfaces.

**The Canvas First Rule.** Keep support chrome restrained enough that diagram state and selected components remain the strongest visual information.

## Shapes

Controls use small rounded corners; compact toolbars are slightly softer. Panels and diagram cards use the panel radius; the application frame and demonstration use the studio radius. Pills serve short badges and chips. Fine borders articulate surfaces without heavy ornamental frames.

## Components

### Buttons

Primary workbench buttons use signal red, white text, compact corners, and medium padding. Secondary buttons use neutral surfaces and borders; ghost buttons use muted text with a surface hover. Workbench presses scale subtly to 0.97; landing actions have a 48px minimum height. Keyboard focus remains visible. Disabled controls reduce opacity and block activation.

### Chips

Short rounded badges identify brand and semantic states. Brand chips use the redline selection wash and stronger signal-red text. Labels remain meaningful without relying on fill color alone.

### Cards / Containers

Graph cards use theme-aware surfaces, restrained borders, and panel corners. Selection shifts border and background into the redline scale. Hover uses raised elevation; changed cards briefly highlight before returning to their normal surface.

### Inputs / Fields

Import and chat fields inherit the surface, line, text, and signal-red focus vocabulary. Carets use the focus token. Visible labels, inline feedback, and disabled states follow the surrounding flow.

### Navigation

Compact segmented controls sit on neutral surfaces with small gaps. Active segments use a filled surface and soft elevation. Mobile workbench navigation explicitly names Chat, Canvas, and History.

### Drafting Canvas and Motion

The demonstration uses a 32px drafting grid with low-opacity lines. Reveal nodes in dependency order, then fade in connections after their endpoints. React Flow positions wrappers with transforms, so reveals animate opacity or card content. Changed components get brief feedback. Traffic particles represent active simulation; a generation scan belongs only to a pending canvas. Controls generally use 150–200ms transitions and panels use the shared ease-out curve. Reduced-motion mode hides traffic particles and resolves reveals immediately.

## Do's and Don'ts

- **Do** use shared theme-aware tokens across landing, editor, and import.
- **Do** preserve readable graph names, labeled controls, and visible keyboard focus.
- **Do** express state through labels and icons alongside semantic color.
- **Do** use meaningful dependency reveals and respect reduced motion.
- **Don't** animate transforms on positioned React Flow wrappers.
- **Don't** imply illustrative fixtures are live project results.
- **Don't** let support panels or floating tools obscure the diagram.
