# SOFTWARE REQUIREMENTS SPECIFICATION
# CREATIVE CAROUSEL STUDIO
## Version 1.0

You are acting as a senior software architect, full-stack engineer, UI/UX designer, and multimedia application developer.

Your task is to design and build a complete, production-quality creative design application inspired by the functionality of SCRL, with an original product identity, interface, codebase, and assets.

This is not a static UI prototype. Build a genuinely functional application.

# 1. PRODUCT OVERVIEW

## 1.1 Product Vision

Create a professional web-based creative studio for designing Instagram carousels using photos, videos, typography, shapes, stickers, and other visual elements.

The application must support both seamless panoramic carousels and independently designed slides.

The experience should combine the creative freedom of professional graphic design software with the simplicity of a modern mobile editing application.

The application must work on:
- iPhone through Safari and installation as a Progressive Web App (PWA).
- iPad through Safari.
- Desktop through modern browsers.

The application must have a mobile-first responsive design without sacrificing desktop editing capabilities.

## 1.2 Core Principles

- Mobile-first experience.
- Professional design capabilities.
- Seamless carousel creation.
- Photo and video editing in one project.
- Extensive typography options.
- Custom local font importing.
- Editable templates.
- Non-destructive editing.
- Reliable autosave.
- High-quality export.
- Responsive and performant interface.

## 1.3 Product Scope

Build one complete application without subscription tiers, payment systems, premium restrictions, or monetization features.

All implemented creative tools should be accessible without artificial feature restrictions.

# 2. TECHNOLOGY STACK

Use the following recommended stack:

Frontend:
- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui

Canvas:
- Konva.js with React Konva, or an equivalent suitable rendering engine.
- Separate document model from canvas rendering.

State management:
- Zustand.

Database and backend:
- Supabase.
- PostgreSQL.
- Supabase Authentication.
- Supabase Storage.

Local persistence:
- IndexedDB.
- Appropriate browser storage APIs.

Image processing:
- Canvas API.
- Web Workers.
- ImageBitmap where supported.

Video processing:
- WebCodecs where supported.
- FFmpeg.wasm where appropriate.
- Server-side rendering as a fallback for resource-intensive exports.

PWA:
- Web App Manifest.
- Service Worker.
- Offline support.
- Installable Home Screen experience.

Use compatible, maintained libraries. Verify actual platform support before implementing browser-dependent functionality.

# 3. APPLICATION STRUCTURE

The application must contain the following main sections:

1. Dashboard
2. Design Editor
3. Templates Library
4. Asset Library
5. Font Library
6. Brand Kits
7. Project Management
8. Settings

## 3.1 Dashboard

Create a clean, modern creative dashboard.

Include:
- Create New Project.
- Recent Projects.
- My Projects.
- Project folders.
- My Templates.
- Favorite Templates.
- My Assets.
- My Fonts.
- Brand Kits.
- Search.
- User Settings.

Project management:
- Create project.
- Rename project.
- Duplicate project.
- Delete project.
- Organize into folders.
- Save as draft.
- Open previous project.
- Display project thumbnails.
- Display last modified date.
- Autosave project changes.

# 4. CANVAS AND EDITOR

The editor is the most important part of the application.

Build a real object-based design editor.

## 4.1 Workspace

The workspace must support:
- Freeform canvas.
- Infinite or expandable workspace.
- Zoom in and out.
- Pan.
- Fit canvas to screen.
- Center canvas.
- Grid.
- Rulers.
- Smart guides.
- Snap to grid.
- Snap to center.
- Alignment guides.
- Safe area guides.
- Margin guides.
- Undo and redo.
- Copy and paste.
- Duplicate.
- Delete.
- Multi-select.
- Group and ungroup.
- Lock and unlock.
- Hide and show elements.

## 4.2 Canvas Presets

Provide the following presets:

- Instagram Portrait: 1080 × 1350 px.
- Instagram Square: 1080 × 1080 px.
- Instagram Landscape: 1080 × 566 px.
- Instagram Story: 1080 × 1920 px.
- Custom dimensions.

Allow users to set the number of slides when creating a project.

## 4.3 Editor Layout - Desktop

Use a professional design application layout:

Top toolbar:
- Project name.
- Undo.
- Redo.
- Save status.
- Zoom controls.
- Preview.
- Export.

Left sidebar:
- Templates.
- Uploads.
- Photos.
- Videos.
- Text.
- Fonts.
- Elements.
- Stickers.
- Backgrounds.
- Brand assets.

Center:
- Main canvas.

Right sidebar:
- Selected object properties.
- Position.
- Dimensions.
- Rotation.
- Opacity.
- Color.
- Typography.
- Image adjustments.
- Video settings.
- Layer settings.

Bottom panel:
- Slide navigator.
- Video timeline when applicable.

Allow panels to collapse and expand.

## 4.4 Editor Layout - iPhone

Do not simply scale down the desktop interface.

Create a dedicated mobile editing experience.

Requirements:
- Canvas as the primary screen area.
- Bottom editing toolbar.
- Bottom-sheet properties panel.
- Horizontal slide thumbnail navigation.
- Collapsible layers panel.
- Touch-based object manipulation.
- Pinch-to-zoom.
- Two-finger canvas pan.
- Tap to select.
- Drag to move.
- Long press for contextual actions.
- Double tap to edit text.
- Safe-area support.
- Touch-friendly controls.

The mobile editor must remain practical and comfortable on iPhone screens.

# 5. CAROUSEL SYSTEM

This is the application's core feature.

Support two editing modes:

1. Seamless Carousel.
2. Independent Slides.

## 5.1 Seamless Carousel

Allow users to create one large panoramic design that automatically spans multiple slides.

Example:

A six-slide portrait carousel:
- Each slide: 1080 × 1350 px.
- Total canvas: 6480 × 1350 px.

Requirements:
- Automatic slide division.
- Continuous backgrounds.
- Elements crossing slide boundaries.
- Continuous typography across slides.
- Image spanning multiple slides.
- Consistent positioning.
- Slide boundary indicators.
- Seamless alignment preview.
- Automatic slicing during export.

Objects crossing slide boundaries must render at exactly matching positions and scales.

## 5.2 Independent Slides

Each slide can have its own composition.

Requirements:
- Add slide.
- Delete slide.
- Duplicate slide.
- Reorder slides.
- Rename slides.
- Edit slides independently.
- Set individual backgrounds.
- Copy elements between slides.
- Duplicate elements.
- Move elements between slides.

## 5.3 Carousel Preview

Provide:
- Full carousel preview.
- Individual slide preview.
- Horizontal swipe preview.
- Seamless transition preview.
- Slide order preview.
- Mixed-media preview.

# 6. PHOTO EDITOR

Support image imports from:
- iPhone Photos.
- iOS Files.
- Desktop local storage.
- Drag and drop.
- Supported image URLs where appropriate.

Support common formats:
- JPG.
- JPEG.
- PNG.
- WebP.
- HEIC when browser decoding is available or through a compatible conversion workflow.
- SVG with security validation.

Photo editing tools:

Basic:
- Crop.
- Rotate.
- Flip horizontal.
- Flip vertical.
- Resize.
- Position.
- Scale.
- Opacity.
- Aspect ratio.

Advanced:
- Brightness.
- Exposure.
- Contrast.
- Saturation.
- Temperature.
- Tint.
- Highlights.
- Shadows.
- Sharpness.
- Blur.
- Vignette.
- Grayscale.
- Duotone.
- Color overlay.
- Blend modes.
- Image masking.
- Clipping masks.
- Rounded corners.
- Borders.
- Stroke.
- Drop shadow.
- Background removal integration where available.

Filters:
- Vintage.
- Analog film.
- Cinematic.
- Black and white.
- Warm.
- Cool.
- Faded.
- Film grain.
- Editorial.
- Retro.

Allow users to save custom image adjustment presets.

Preserve original assets and implement non-destructive adjustments.

# 7. VIDEO EDITOR

Video support is a core requirement, not an optional afterthought.

## 7.1 Video Import

Support:
- MP4.
- MOV.
- WebM when supported.
- H.264 where supported.
- Other codecs based on actual browser compatibility.

Import from:
- iPhone Photos.
- iOS Files.
- Desktop local storage.

Generate:
- Video thumbnails.
- Poster frames.
- Duration metadata.
- Dimensions metadata.

## 7.2 Video Editing

Implement:
- Trim start and end.
- Split clips.
- Crop.
- Rotate.
- Resize.
- Position.
- Scale.
- Opacity.
- Volume control.
- Mute.
- Playback speed.
- Loop.
- Poster frame selection.
- Video filters.
- Color adjustments.
- Video masking.
- Video border.
- Video shadow.
- Background music.
- Audio controls.

## 7.3 Video Timeline

Create a functional timeline containing:
- Playhead.
- Playback controls.
- Video tracks.
- Image tracks.
- Text overlay tracks.
- Audio tracks.
- Clip duration controls.
- Drag and drop.
- Timeline zoom.
- Split controls.
- Clip trimming.
- Audio waveform where practical.

## 7.4 Mixed Media Carousel

One project must support different media types on different slides.

Example:
- Slide 1: Photo.
- Slide 2: Video.
- Slide 3: Photo with typography.
- Slide 4: Video with overlays.
- Slide 5: Photo collage.
- Slide 6: Video.

The application must correctly preserve slide order and media type.

Photo slides export as image files.
Video slides export as MP4 files.

The final mixed-media carousel should be packaged into an ordered ZIP file.

Do not incorrectly combine every slide into one video.

# 8. TYPOGRAPHY AND FONT MANAGEMENT

Typography is a major product priority.

Build a comprehensive font management system.

## 8.1 Built-in Font Library

Organize fonts into categories:

Sans Serif:
- Inter.
- Montserrat.
- Poppins.
- Manrope.
- Outfit.
- Sora.
- DM Sans.

Serif:
- Playfair Display.
- Cormorant Garamond.
- Lora.
- Libre Baskerville.
- DM Serif Display.

Display:
- Bebas Neue.
- Anton.
- Oswald.
- Abril Fatface.

Editorial:
- Bodoni Moda.
- Instrument Serif.
- Prata.

Monospace:
- Roboto Mono.
- Space Mono.
- IBM Plex Mono.

Handwriting:
- Caveat.
- Dancing Script.
- Kalam.

Script:
- Pacifico.
- Great Vibes.

Retro:
- Special Elite.
- Other appropriately licensed fonts.

Only distribute fonts with licenses that permit embedding and redistribution.

## 8.2 Typography Controls

Implement:
- Font family.
- Font weight.
- Font style.
- Font size.
- Line height.
- Letter spacing.
- Paragraph spacing.
- Alignment.
- Text transformation.
- Text color.
- Text opacity.
- Text stroke.
- Text shadow.
- Text background.
- Rotation.
- Text box resizing.
- Auto-fit.
- Vertical alignment.
- Text outline.
- Text curve where technically feasible.

## 8.3 Custom Font Upload

This is mandatory.

Users must be able to upload fonts from local storage.

Support:
- TTF.
- OTF.
- WOFF.
- WOFF2.

Requirements:
- Upload single fonts.
- Upload multiple fonts.
- Font preview.
- Font search.
- Font favorites.
- Recently used fonts.
- Font categorization.
- Rename custom fonts.
- Delete custom fonts.
- Font weight mapping.
- Font style mapping.
- Custom font collections.

On iPhone:
- Provide an Upload Font button.
- Open the iOS Files picker.
- Read compatible local font files.
- Register fonts through the FontFace API.
- Store font files persistently in IndexedDB.
- Restore custom font availability after restarting the PWA.

Do not assume uploaded fonts become available system-wide on iOS.

The editor and export renderer must both use the same font definitions.

Validate font files and handle unsupported or corrupted files gracefully.

# 9. SHAPES, ELEMENTS AND STICKERS

Provide:
- Rectangle.
- Circle.
- Ellipse.
- Triangle.
- Polygon.
- Star.
- Line.
- Arrow.
- Custom shapes.
- Freeform drawing.
- Pen tool where feasible.
- SVG import.
- PNG overlays.
- Frames.
- Masks.
- Borders.
- Stickers.
- Doodles.
- Hand-drawn elements.
- Torn paper.
- Film frames.
- Textures.
- Grain overlays.
- Light leaks.

Every element must support:
- Resize.
- Rotate.
- Move.
- Opacity.
- Color.
- Duplicate.
- Delete.
- Lock.
- Layer ordering.

# 10. BACKGROUND AND COLOR SYSTEM

Support:
- Solid colors.
- Linear gradients.
- Radial gradients.
- Multi-color gradients.
- Image backgrounds.
- Video backgrounds.
- Transparent backgrounds.
- Pattern backgrounds.
- Texture backgrounds.

Color tools:
- HEX input.
- RGB input.
- HSL input.
- Color picker.
- Saved palettes.
- Recent colors.
- Brand colors.
- Eyedropper where supported.

# 11. TEMPLATE LIBRARY

Create a fully editable template library.

Categories:
1. Minimalist.
2. Editorial.
3. Magazine.
4. Photography.
5. Fashion.
6. Travel.
7. Lifestyle.
8. Food.
9. Business.
10. Marketing.
11. Portfolio.
12. Wedding.
13. Music.
14. Film Aesthetic.
15. Vintage.
16. Brutalist.
17. Typography.
18. Scrapbook.
19. Moodboard.
20. Photo Dump.
21. Storytelling.
22. Product Showcase.
23. Tutorial.
24. Educational Carousel.
25. Video Carousel.

Template features:
- Template thumbnails.
- Template preview.
- Search.
- Category filtering.
- Aspect ratio filtering.
- Slide count filtering.
- Favorite templates.
- Recently used templates.
- Apply template.
- Duplicate template.
- Customize template.
- Save custom design as template.

Templates must consist of editable design objects, not flattened images.

Support image placeholders, video placeholders, text placeholders, font settings, colors, and editable layouts.

Create an architecture that allows administrators to add new templates later.

# 12. LAYER MANAGEMENT

Implement a professional layer panel.

Requirements:
- Layer list.
- Rename.
- Reorder.
- Duplicate.
- Delete.
- Group.
- Ungroup.
- Lock.
- Unlock.
- Hide.
- Show.
- Multi-select.
- Opacity.
- Blending modes.
- Parent-child grouping.

Every design object must have a unique ID.

Maintain consistent layer ordering in both canvas preview and export.

# 13. EXPORT SYSTEM

Export quality is critical.

## 13.1 Image Export

Support:
- JPG.
- PNG.
- WebP.
- Individual slide export.
- Selected slide export.
- Export all slides.
- ZIP download.
- Custom resolution.
- Compression settings.
- High-quality rendering.

## 13.2 Video Export

Support:
- MP4.
- H.264 when supported by the selected rendering environment.
- 720p.
- 1080p.
- 30 FPS.
- 60 FPS where supported.
- Bitrate settings where available.
- Individual video slide export.
- Export all video slides.

## 13.3 Export Requirements

Include:
- Instagram-ready presets.
- Preview before export.
- Export progress.
- Cancel export.
- Error reporting.
- Background processing where supported.
- ZIP packaging.
- Correct slide numbering.
- Consistent file naming.

Verify:
- Correct dimensions.
- Correct typography.
- Correct positioning.
- Correct layer order.
- Correct image quality.
- Correct video timing.
- Correct aspect ratio.
- Seamless alignment.

The preview renderer and export renderer must share the same document geometry and transformation logic.

Do not fake export functionality.

# 14. ASSET LIBRARY

Create a reusable asset management system.

Users can:
- Upload photos.
- Upload videos.
- Upload SVG.
- Upload PNG.
- Organize assets.
- Search assets.
- Favorite assets.
- Delete assets.
- Reuse assets in multiple projects.

Store metadata such as:
- Filename.
- File type.
- File size.
- Dimensions.
- Duration for video.
- Upload date.
- Storage location.

Keep original assets separate from temporary previews and thumbnails.

# 15. BRAND KIT

Allow users to create brand kits containing:
- Logos.
- Primary colors.
- Secondary colors.
- Brand fonts.
- Typography styles.
- Reusable graphic elements.

Allow multiple brand kits per user.

# 16. ADDITIONAL CREATIVE FEATURES

Design the architecture to support future implementation of:

AI Design Assistant:
- Prompt-based layout generation.
- Font pairing suggestions.
- Color palette suggestions.
- Automatic image placement.
- Carousel text suggestions.
- Template recommendations.
- Smart cropping.
- Background removal.

Smart Seamless Assistant:
- Detect elements crossing slide boundaries.
- Detect misaligned elements.
- Detect discontinuous backgrounds.
- Suggest alignment corrections.
- Display adjacent slide previews.

Advanced layout:
- Photo grids.
- Masonry layouts.
- Asymmetric collages.
- Magazine compositions.
- Overlapping photo arrangements.
- Film contact sheets.
- Scrapbook layouts.

These features should be modular and must not delay implementation of the core editing engine.

# 17. PROJECT DOCUMENT ARCHITECTURE

Use a structured and versioned document model.

Example:

interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  slides: Slide[];
  assets: Asset[];
  fonts: CustomFont[];
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

interface Slide {
  id: string;
  index: number;
  background: Background;
  elements: DesignElement[];
  duration?: number;
}

interface DesignElement {
  id: string;
  type: "image" | "video" | "text" | "shape" | "sticker";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  properties: Record<string, unknown>;
}

This is an initial illustration, not a complete final schema.

Extend the schema to cover:
- Video timing.
- Audio.
- Font references.
- Filters.
- Masks.
- Blend modes.
- Animation.
- Groups.
- Asset references.
- Slide transitions where applicable.

Use validation schemas and migration strategies.

The document model must remain independent of UI components.

# 18. DATABASE ARCHITECTURE

Recommended entities:

- users
- projects
- project_versions
- slides
- assets
- fonts
- templates
- template_categories
- stickers
- brand_kits

Use relational references where appropriate.

Store binary assets in object storage, not directly inside database records.

Implement appropriate:
- User authentication.
- Authorization.
- Row-level security.
- Private storage policies.
- Asset ownership.
- Project ownership.

Allow local-only projects where practical.

# 19. PERFORMANCE AND RELIABILITY

Requirements:
- Responsive canvas interactions.
- Target 60 FPS where device capability allows.
- Autosave without blocking editing.
- Asynchronous thumbnail generation.
- Web Workers for expensive processing where supported.
- Efficient memory management.
- Preview proxies for large images.
- Lazy loading.
- Resource cleanup.
- Video memory management.
- Recovery after unexpected browser closure.
- Clear error states.
- Asset integrity checks.

Do not block the main UI thread with expensive video or image processing.

Support large projects through progressive loading and sensible resource limits.

# 20. PWA AND IOS REQUIREMENTS

The application must be installable on iPhone through Safari's Add to Home Screen workflow.

Implement:
- Valid Web App Manifest.
- Service Worker.
- Standalone display mode.
- Application icons.
- Offline shell.
- IndexedDB persistence.
- Safe-area handling.
- Touch gesture support.
- iOS viewport configuration.
- Local font persistence.
- Local project persistence.

Users should be able to reopen previously cached local projects without an internet connection.

Clearly communicate when a feature requires internet access.

Important limitations:
- PWA background execution is limited on iOS.
- Browser file access is permission-based.
- Video codecs vary by browser and device.
- Large files can exceed available device memory.
- Native Photos APIs are not automatically available to web applications.

Use feature detection and fallback strategies.

Never claim unsupported native capabilities.

# 21. SECURITY AND PRIVACY

Implement:
- Secure authentication.
- Access control.
- Private asset storage.
- File type validation.
- File size validation.
- Safe SVG handling.
- Font file validation.
- Secure upload handling.
- Protection against unauthorized asset access.

User projects and uploads must not be publicly accessible by default.

# 22. TESTING AND ACCEPTANCE CRITERIA

The application must pass the following practical workflows:

1. Create a project.
2. Create at least 10 slides.
3. Import multiple photos.
4. Import a video.
5. Create a mixed photo and video carousel.
6. Create a seamless panoramic design.
7. Add text and edit typography.
8. Upload a custom TTF font.
9. Reopen the application and confirm the font remains available.
10. Add shapes and stickers.
11. Change background gradients.
12. Reorder slides.
13. Reorder layers.
14. Undo and redo changes.
15. Save and reopen a project.
16. Export all image slides as JPG or PNG.
17. Export video slides as MP4.
18. Package the mixed-media carousel as ZIP.
19. Confirm exported positioning matches canvas preview.
20. Test on Safari iPhone.
21. Install the PWA on an iPhone Home Screen.
22. Reopen a locally stored project offline.

Create automated tests for document models, transformations, persistence, and export logic wherever feasible.

Test actual device behavior, not just desktop browser simulation.

# 23. DEVELOPMENT ROADMAP

Implement the application in the following phases.

PHASE 1 - FOUNDATION AND BASIC EDITOR

- Project setup.
- PWA configuration.
- Dashboard.
- Project management.
- Document schema.
- Canvas engine.
- Slide system.
- Image import.
- Basic image manipulation.
- Text editing.
- Basic shapes.
- Layer panel.
- Undo/redo.
- Autosave.
- JPG and PNG export.

PHASE 2 - PROFESSIONAL DESIGN FEATURES

- Advanced typography.
- Custom font upload.
- Font library.
- Photo filters.
- Image adjustments.
- Masks.
- Gradients.
- Stickers.
- Overlays.
- Editable templates.
- Seamless carousel.
- Brand kits.

PHASE 3 - VIDEO EDITING

- Video import.
- Video preview.
- Timeline.
- Trimming.
- Splitting.
- Audio controls.
- Mixed-media slides.
- Video rendering.
- MP4 export.
- Export validation.

PHASE 4 - ADVANCED FEATURES

- Advanced layouts.
- Template creator.
- Project version history.
- Cloud synchronization.
- AI assistant integration.
- Advanced asset management.
- Advanced image tools.

PHASE 5 - PRODUCTION

- Security testing.
- Performance optimization.
- iOS testing.
- Browser compatibility.
- Error handling.
- Recovery testing.
- Accessibility.
- Deployment.
- Documentation.

# 24. DESIGN DIRECTION

The application should look like a premium creative software product.

Visual direction:
- Minimalist.
- Modern.
- Professional.
- Editorial.
- Clean typography.
- Excellent spacing.
- Subtle borders.
- Refined icons.
- Smooth interactions.
- Clear hierarchy.

Avoid:
- Generic SaaS dashboard appearance.
- Excessively rounded UI elements.
- Unnecessary gradients everywhere.
- Excessive decorative elements.
- Cluttered toolbars.
- Oversized controls.
- Poor mobile usability.

Use a neutral design system that allows the actual creative canvas to remain the visual focus.

Provide light and dark themes if practical.

# 25. IMPORTANT DEVELOPMENT INSTRUCTIONS FOR CLAUDE

Do not attempt to build every feature in one giant code generation step.

Follow this exact process:

STEP 1:
Inspect the existing repository and identify its current structure, dependencies, and implementation status.

STEP 2:
Create a detailed technical architecture and development plan.

STEP 3:
Create the project structure and foundational document model.

STEP 4:
Implement Phase 1 incrementally.

STEP 5:
Run type checks, linting, and automated tests.

STEP 6:
Test the actual user workflows.

STEP 7:
Fix bugs before proceeding.

STEP 8:
Document completed functionality and known limitations.

STEP 9:
Move to the next phase only after the previous phase is stable.

Additional rules:
- Do not create placeholder buttons that do nothing.
- Do not use mock functionality for critical editor operations.
- Do not claim features are complete without testing them.
- Do not use static screenshots as substitutes for a working editor.
- Do not flatten editable templates into images.
- Do not compromise the document architecture for quick UI implementation.
- Do not discard existing working code without justification.
- Use reusable components and modular services.
- Keep the codebase maintainable.
- Document technical decisions.
- Report limitations honestly.
- Prioritize working functionality over decorative UI.

# 26. FIRST TASK

Start by inspecting the repository.

Then:
1. Propose the complete architecture.
2. Define the folder structure.
3. Define the document schema.
4. Identify the required dependencies.
5. Explain the rendering architecture.
6. Explain the persistence strategy.
7. Explain the iOS PWA compatibility strategy.
8. Provide the detailed Phase 1 implementation checklist.

After presenting the architecture, begin implementing Phase 1.

Do not jump to video editing or AI features before the foundation and basic canvas editor work reliably.

The ultimate goal is a complete, professional, reliable creative carousel studio that users can comfortably operate on both iPhone and desktop.

Build real software, not merely a visual demonstration.