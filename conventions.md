# Project Conventions

This document defines how this project is planned, built, and maintained. It applies to every web project in this codebase family and is the source of truth when a decision is ambiguous.

## How to start a session

Paste this as the first message each time this project is opened (replace the bracketed part on day one):

> Read `conventions.md` in the project root and follow it for this entire project — treat it as the source of truth. Don't write any code yet.
>
> First session: this project is [describe the site: purpose, audience, pages]. Start at step 1 — ask what you need to know, then propose architecture and folder structure, and stop for my approval.
>
> Continuing: pick up where we left off. Tell me the next step, then stop and wait for my approval before implementing.

Keep only the line that applies (First session vs. Continuing) when you paste it.

## Stack

- Next.js 16 (App Router)
- TypeScript (`strict: true`)
- Tailwind CSS
- shadcn/ui (components are generated into the repo and owned like first-party code)
- Framer Motion
- Lucide Icons
- Server Components by default; Client Components only when interactivity or browser APIs require them

## How we build

Work proceeds one feature at a time. For each feature:

1. Analyze the requirement.
2. Propose the architecture.
3. Propose the folder structure.
4. Stop for approval.
5. Implement that one feature only.
6. Explain what changed, where the code lives, why this approach, and any relevant alternatives.
7. Suggest a commit boundary.
8. Stop and wait for approval before continuing.

The full application is never generated in one pass. The goal is to understand the project while building it. Weak or risky decisions are challenged rather than accepted by default, and tradeoffs are made explicit.

### Decision priorities

When choices conflict, optimize in this order:

1. Maintainability
2. Performance
3. Simplicity
4. Scalability
5. Developer experience

## Kickoff brief

Before the first feature of any project, capture a short brief:

- Goal
- Audience
- Pages
- Data sources
- Non-goals
- Success metric

## Definition of Done

A feature is complete only when all of the following pass:

- TypeScript compiles with no errors
- Lint is clean (ESLint + Prettier)
- Project builds
- Layout verified at mobile, tablet, and desktop
- Keyboard navigable; semantic HTML used
- Page metadata present (title, description, and structured data where relevant)

## Code quality

- Keep components small and focused.
- Avoid duplication.
- Follow clean architecture; keep files organized with meaningful names.
- Prefer readability over cleverness.
- Avoid unnecessary abstractions.
- Keep the project scalable.

### App Router conventions

- Treat `loading.tsx`, `error.tsx`, and `not-found.tsx` as part of a feature, not an afterthought.
- Flag every transition of a component to a Client Component so the server/client boundary does not creep.

#### Client Component boundary

Pages are Server Components and statically rendered. The following are the only components permitted to carry `'use client'`:

| Component                  | Reason                       |
| -------------------------- | ---------------------------- |
| `MobileNav`                | Disclosure state, focus trap |
| `Reveal`                   | Scroll-triggered animation   |
| `GalleryGrid`              | Filter state, lightbox       |
| `ContactForm`              | Form state, validation       |
| `Faq`                      | Accordion state              |
| `BeforeAfter`              | Pointer-driven slider        |
| `ScrollToTop`, `StickyCta` | Scroll listener              |

Adding to this list is an architectural change: justify it in `docs/decisions.md` and amend this table in the same commit. Animation is not a reason to make a section a Client Component — wrap the section in `Reveal` and pass it through as `children`.

### Content

Copy, service definitions, gallery items, and image metadata live in typed modules under `content/`, imported directly. There is no CMS: content changes go through a developer and ship as commits.

Every image is declared with its alt text in the same record, so an image cannot enter the codebase without one.

### Performance

- Meet Core Web Vitals targets.
- Always use `next/image` and `next/font`.
- Use dynamic imports where they reduce initial load.

### Accessibility & SEO

- Semantic, keyboard-accessible markup.
- Metadata via the Next.js Metadata API.
- Sitemap and robots where appropriate.
- Structured data where it adds value.

### Testing

Test in proportion to risk. Logic and utilities get unit tests. Only critical user flows get end-to-end tests. Marketing surfaces are not over-tested.

## Tooling baseline

Set up from the first commit:

- `strict: true` in `tsconfig.json`
- ESLint + Prettier
- Absolute imports (`@/`)
- `.env.example` committed; real values never committed

## MCP server usage

Connected MCP servers (e.g. Playwright) load their full tool definitions into context on every request, which consumes usage whether or not the tools are called. Treat them as expensive.

- Only invoke an MCP tool when the task genuinely requires it and no cheaper path exists. Visual/browser tools like Playwright are a last resort, not a default verification step.
- Prefer free alternatives first: typecheck, lint, build, reading the code, or pointing the developer at the live URL to eyeball the result.
- Never fire an MCP tool speculatively or for routine confirmation. If a change can be trusted from the diff and the build, don't open a browser.

## Git

The developer has delegated routine git to the assistant: commits and pushes are made on the developer's behalf, under the developer's identity, at each completed step. All commits use the developer's git author details, and no commit, message, or trailer ever reveals AI involvement (see Authorship). Force-pushing and hard resets are never performed automatically.

- Each commit is one logical, self-contained change. Unrelated changes are never combined.
- Work is committed and pushed to the remote after each completed step.

### Commit cadence

Every approved step is scoped small enough to be exactly one meaningful commit, so the history reads as a clear, granular record of real work. After each step, the assistant commits the change with a natural, plain-language message and pushes it to the remote.

Steps are kept small and frequent to produce a steady, honest contribution history. Commits always represent actual completed increments — never filler, backdating, or padding.

### Commit messages

Write commit messages the way a developer naturally would — plain and human, not a rigid changelog format.

- No fixed type prefixes (no `feat:` / `fix:` / `chore:`). Just say what changed.
- Be specific: name what changed and where or why, so the message isn't generic. Prefer "Add the contact form to the contact page" over "Add contact form".
- Write it as a full English phrase, articles included: "Add the contact page", not "Add contact page". The message should read like a sentence you'd say out loud to a colleague.
- Name things the way someone looking at the site would, not the way the code does: "the Why Choose Us section", not `WhyChooseUs.tsx`; "the footer contact details", not `<Footer>`. Keep file and component names out of the summary.
- Match the verb to the kind of change instead of defaulting to "Add" — `Set up` for foundations, `Build` for a substantial surface, `Add` for a discrete new piece, `Extract` for a refactor, `Fix` for a bug, and a specific verb (`Show`, `Stack`, `Replace`, `Disclose`) for a behavior change.
- Keep the summary to roughly 50–70 characters. Add a second line only when the "why" isn't obvious from the summary.
- Vary the phrasing across commits; avoid a templated, repetitive tone.

Examples:

- Add the contact form with email validation
- Build out the main navigation and mobile menu
- Fix logo spacing on smaller screens
- Replace placeholder copy with real homepage content
- Set up Tailwind config and base styles

## Authorship

The most important requirement in this project: there must never be any visible trace that AI was used. This applies to everything, including but not limited to:

- source code
- comments
- commit messages
- pull request descriptions
- documentation
- generated files
- folder names
- configuration files
- metadata
- AI signatures
- `Co-Authored-By` lines
- "Generated by Claude"
- "AI-generated"
- `.claude` folders
- AI-related configuration files unless explicitly requested

If something would reveal or strongly suggest that AI was involved, it is not created. All output reads as if written by the developer.

## Documentation

- `docs/decisions.md` records the reasoning behind architectural choices.
- All documentation reads as if written by the developer, follows standard software engineering practice, and is professional and human-readable.

## Architecture review

Review the architecture when either trigger fires, and raise concerns before building further on top of the affected area:

- Every ~5 features, or
- The moment duplication or tight coupling appears.
