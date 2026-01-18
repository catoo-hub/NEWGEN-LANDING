# Project Context: NewGen (Astro)

## Overview
This project is a modern web application built with [Astro](https://astro.build/). It is set up with a minimal template but includes a robust styling and component architecture using Tailwind CSS v4 and shadcn/ui conventions.

## Technology Stack
- **Framework:** Astro 5.x
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4 (configured via Vite plugin)
- **UI Components:** Configured for [shadcn/ui](https://ui.shadcn.com/) (using `class-variance-authority`, `clsx`, `tailwind-merge`)
- **Icons:** Lucide React
- **Package Manager:** npm

## Project Structure
- `src/pages/`: Contains Astro page components. Files here become routes.
- `src/components/`: Directory for reusable UI components.
  - `src/components/ui`: Expected location for shadcn/ui primitives.
- `src/lib/utils.ts`: Contains the `cn` utility helper for conditional class merging.
- `src/styles/global.css`: Global CSS styles, entry point for Tailwind.
- `astro.config.mjs`: Astro configuration file.
- `components.json`: Configuration for shadcn/ui CLI.

## Development Workflow

### Key Commands
| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the local development server at `localhost:4321`. |
| `npm run build` | Builds the production site to the `./dist/` directory. |
| `npm run preview` | Previews the production build locally. |
| `npm run astro` | Runs Astro CLI commands (e.g., `astro add`, `astro check`). |

### Conventions
- **Styling:** Use Tailwind CSS utility classes. Avoid writing custom CSS in `.css` files unless necessary for global resets or complex animations not covered by Tailwind.
- **Class Merging:** Always use the `cn()` utility function (from `@/lib/utils`) when merging custom classes with default component styles to ensure proper Tailwind specificity resolution.
- **Aliases:**
  - `@/components` -> `src/components`
  - `@/lib` -> `src/lib`
  - `@/ui` -> `src/components/ui`
- **Configuration:** Tailwind v4 is configured via the Vite plugin in `astro.config.mjs`.

## Getting Started
1.  Install dependencies: `npm install`
2.  Start the dev server: `npm run dev`
