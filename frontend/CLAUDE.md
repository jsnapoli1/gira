# frontend/ - React Frontend

Vite-powered React application with TypeScript for the Zira UI.

## Tech Stack

- React 18 with TypeScript
- Vite for build/dev server
- React Router for navigation
- @dnd-kit for drag-and-drop
- Recharts for charts
- Lucide React for icons
- CSS (no Tailwind - uses App.css)

## Project Structure

```
frontend/
├── src/
│   ├── api/           # API client
│   ├── components/    # Reusable components
│   ├── context/       # React contexts
│   ├── pages/         # Route pages
│   └── types/         # TypeScript types
├── e2e/               # Playwright E2E tests
└── dist/              # Build output
```

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (port 5173)
npm run build        # Production build
npm test             # Run Playwright tests
npm run test:ui      # Playwright UI mode
npm run test:headed  # Tests in browser
```

## Routes

| Path | Page | Auth |
|------|------|------|
| `/login` | Login | Public |
| `/signup` | Signup | Public |
| `/boards` | Board list | Private |
| `/boards/:id` | Board view | Private |
| `/boards/:id/settings` | Board settings | Private |
| `/reports` | Reports | Private |
| `/settings` | Gitea config | Private |

## Best Practices

### Testing
- All features need E2E tests in `e2e/`
- Test file pattern: `*.spec.ts`
- Run tests before committing: `npm test`

### Components
- Keep components small and focused
- Use TypeScript interfaces from `types/`
- Follow existing patterns in `pages/`

### API Calls
- Use functions from `api/client.ts`
- Token is auto-attached from localStorage
- Handle errors in components

### Styling
- Add styles to `App.css`
- Follow existing class naming conventions
- No inline styles
