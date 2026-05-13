# User Stories — Design Mode

## Primary persona

**The agentic developer.** Ships React apps. Uses T3 Code with Claude/Codex/OpenCode for most coding work. Has a real codebase with a design system that has accreted over time. Wants to move faster on UI work without throwing away what already exists.

Not the persona: a designer who wants to mock up greenfield screens. There are tools for that. This is for people with an existing app who need new UI that fits in.

## Stories

### Browse mode

**As a developer, I want to open my project in Design Mode and see every route in my app**, so I can navigate the running app inside T3 Code without flipping to a browser.

**As a developer, I want to see every component in my codebase listed and grouped**, so I can find a primitive without grepping.

**As a developer, I want to click any rendered element on a page and have T3 Code show me the component file and props**, so I can stop hunting for the source.

### Inspect mode

**As a developer, I want to render a single component in isolation with a props panel**, so I can see all its variants without writing a Storybook story.

**As a developer, I want to tweak props live and see the result instantly**, so I can decide what variants matter before I write code.

**As a developer, I want to ask the agent to add a new variant or fix the spacing on a component**, and have the change land in the actual source file using the patterns already in the codebase.

### Mockup mode

**As a developer, I want to generate a new screen that uses my existing primitives, tokens, and composition patterns**, so the result looks like it belongs in my app, not like generic shadcn output.

**As a developer, I want to give the agent a screenshot or description and get back a mockup that imports from `@/components/*` and uses my Tailwind config's tokens**, so I don't have to translate generic AI output into my codebase manually.

**As a developer, I want to iterate on a mockup with the agent (move this, change that, try a denser version)** without losing fidelity to the design system.

**As a developer, I want to commit a generated mockup as a real route in my app** with one click, so the workflow doesn't end at "here's some code, copy it."

### Design system awareness

**As a developer, I want T3 Code to know my Tailwind config, my CSS variables, and my component vocabulary** without me having to explain them, so I can stop pasting context into agent prompts.

**As a developer, I want to see what the agent thinks my design system is** and correct it if it's wrong, so the mockup quality is bounded by my codebase's quality, not by the agent's guesses.

### Failure modes the user should never hit

- Agent generates code that imports a nonexistent component
- Agent generates code with arbitrary Tailwind values when the project uses tokens
- Mockup looks correct in Design Mode but breaks when committed because providers/context were faked
- Click-to-select highlights the wrong element or fails silently
- Dev server crashes silently and the user sees a blank iframe with no diagnostic

## Out of scope for v1

- Real-time multi-user collaboration
- Figma import/export
- Visual drag-and-drop layout editing (the "Webflow for React" trap — this is an agent-first product, not a no-code product)
- Mobile preview viewports beyond resize
- Dark/light mode toggling beyond what the project itself supports
- Component prop inference for components without TypeScript types (defer to v2)
