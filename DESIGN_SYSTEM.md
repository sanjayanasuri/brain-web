# Brain Web Design System

## 🎨 Color Palette

### Primary Colors
```css
--ink: #0f172a;           /* Dark blue-black (text) */
--muted: #6b7280;          /* Gray (secondary text) */
--surface: #ffffff;        /* White (cards, panels) */
--border: #d8e2f1;         /* Light blue-gray (borders) */
--accent: #118ab2;         /* Teal/Cyan Blue (primary accent) */
--accent-2: #ef476f;       /* Coral/Pink (secondary accent) */
--panel: rgba(255, 255, 255, 0.82);  /* Semi-transparent white */
```

### Background Gradients
```css
/* Main background */
background: linear-gradient(180deg, #fdf7ec 0%, #eef6ff 60%, #f7f9fb 100%);

/* Graph canvas background */
background: radial-gradient(circle at 30% 20%, rgba(17, 138, 178, 0.08), transparent 40%),
           radial-gradient(circle at 70% 30%, rgba(239, 71, 111, 0.08), transparent 40%),
           linear-gradient(145deg, #f4f7fb 0%, #eef4ff 50%, #fbfdff 100%);

/* Landing page gradient */
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
```

### Domain/Node Colors (Graph Palette)
```css
#118ab2  /* Teal */
#ef476f  /* Coral/Pink */
#06d6a0  /* Mint Green */
#f4a261  /* Orange */
#ffb703  /* Yellow */
#073b4c  /* Dark Blue */
#f28482  /* Salmon */
#7c6ff9  /* Purple */
#52b788  /* Green */
#3a86ff  /* Blue */
```

### Button Gradients
```css
/* Primary button */
background: linear-gradient(120deg, #118ab2, #00b4d8);
color: #ffffff;
box-shadow: 0 10px 20px rgba(17, 138, 178, 0.22);

/* Send button */
background: linear-gradient(120deg, #118ab2, #00b4d8);
box-shadow: 0 10px 20px rgba(17, 138, 178, 0.35);
```

## 🔤 Typography

### Primary Font
```css
font-family: 'Space Grotesk', 'Inter', system-ui, -apple-system, sans-serif;
```
**Google Fonts Import:**
```html
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');
```

### Monospace Font (for code/IDs)
```css
font-family: 'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, monospace;
```
**Google Fonts Import:**
```html
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');
```

### Font Weights
- **400**: Regular
- **500**: Medium
- **600**: Semi-bold (buttons, labels)
- **700**: Bold (headings, emphasis)

### Font Sizes
```css
/* Headings */
.title: 20px (font-weight: 700)
.eyebrow: 11px (uppercase, letter-spacing: 0.08em)
.subtitle: 12px

/* Body */
.chat-text: 13px
.node-card__title: 18px
.explorer-stat__value: 15px
```

## 🎭 Design Principles

### Glassmorphism
- **Backdrop blur**: `backdrop-filter: blur(12px)`
- **Semi-transparent panels**: `rgba(255, 255, 255, 0.82)`
- **Layered depth**: Multiple gradient overlays

### Shadows
```css
--shadow: 0 18px 60px rgba(15, 23, 42, 0.12);
box-shadow: 0 10px 35px rgba(15, 23, 42, 0.08);
```

### Border Radius
- **Cards/Panels**: `12px - 16px`
- **Buttons/Pills**: `999px` (fully rounded)
- **Inputs**: `14px - 16px`

### Spacing
- **Gaps**: `8px - 12px` (flex gaps)
- **Padding**: `10px - 16px` (cards)
- **Margins**: `2px - 8px` (compact spacing)

## 🎨 Component Styles

### Pills/Badges
```css
.pill {
  padding: 8px 12px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid #d8e2f1;
  font-weight: 600;
  font-size: 13px;
  transition: all 0.2s ease;
}

.pill--active {
  border-color: #118ab2;
  color: #118ab2;
  box-shadow: 0 8px 20px rgba(17, 138, 178, 0.22);
}

.pill--ghost {
  background: rgba(17, 138, 178, 0.08);
  border-color: rgba(17, 138, 178, 0.12);
}
```

### Cards
```css
.control-card {
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(17, 138, 178, 0.12);
  backdrop-filter: blur(12px);
  border-radius: 10px;
  padding: 8px 10px;
  box-shadow: 0 18px 60px rgba(15, 23, 42, 0.12);
}
```

### Buttons
```css
.send-btn {
  background: linear-gradient(120deg, #118ab2, #00b4d8);
  color: white;
  border: none;
  border-radius: 14px;
  padding: 10px 16px;
  font-weight: 700;
  box-shadow: 0 10px 20px rgba(17, 138, 178, 0.35);
}

.send-btn:hover {
  transform: translateY(-1px);
}
```

## 🌈 Color Usage Guide

### For Your Portfolio

**Primary Theme Colors:**
- **Dark Blue**: `#0f172a` (text, headings)
- **Teal/Cyan**: `#118ab2` (primary accent, links, buttons)
- **Coral/Pink**: `#ef476f` (secondary accent, highlights)
- **White**: `#ffffff` (backgrounds, cards)
- **Light Gray**: `#6b7280` (muted text)

**Orange/Yellow Accents** (for cyberpunk feel):
- **Orange**: `#f4a261`
- **Yellow**: `#ffb703`

**Background Gradient** (soft, modern):
```css
background: linear-gradient(180deg, #fdf7ec 0%, #eef6ff 60%, #f7f9fb 100%);
```

## 📐 Spacing System

```css
/* Compact spacing */
gap: 4px - 6px
padding: 8px - 10px

/* Standard spacing */
gap: 8px - 12px
padding: 10px - 16px

/* Generous spacing */
gap: 16px - 24px
padding: 16px - 24px
```

## 🎯 Design Tokens Summary

```css
:root {
  /* Colors */
  --ink: #0f172a;
  --muted: #6b7280;
  --surface: #ffffff;
  --border: #d8e2f1;
  --accent: #118ab2;
  --accent-2: #ef476f;
  --panel: rgba(255, 255, 255, 0.82);
  --shadow: 0 18px 60px rgba(15, 23, 42, 0.12);
  
  /* Typography */
  --font-primary: 'Space Grotesk', 'Inter', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, monospace;
  
  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  --spacing-xl: 24px;
  
  /* Border Radius */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-full: 999px;
}
```

## 🚀 Quick Start for Portfolio

### 1. Import Fonts
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### 2. Base Styles
```css
body {
  font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif;
  color: #0f172a;
  background: linear-gradient(180deg, #fdf7ec 0%, #eef6ff 60%, #f7f9fb 100%);
  -webkit-font-smoothing: antialiased;
}
```

### 3. Accent Colors
- Primary: `#118ab2` (teal/cyan)
- Secondary: `#ef476f` (coral)
- Orange: `#f4a261` (for cyberpunk accent)
- Yellow: `#ffb703` (for highlights)

### 4. Component Examples
See `PORTFOLIO_INTEGRATION.md` for HTML snippets using these styles.
