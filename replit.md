# Student Attendance System

A React and Node attendance workspace where teachers manage classes and timed lectures, while students join classes and check in during active attendance windows.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/attendance-system/src/App.tsx` — public landing page, Clerk auth routes, onboarding, teacher/student app shell, dashboards, classes, lectures, and attendance screens.
- `artifacts/api-server/src/routes/attendance.ts` — authenticated API routes and attendance-window enforcement.
- `lib/api-spec/openapi.yaml` — source of truth for generated API hooks and schemas.
- `lib/db/src/schema/index.ts` — Drizzle schema for profiles, classes, class memberships, lectures, and attendance records.
- `artifacts/attendance-system/src/index.css` — shared theme, typography, color tokens, and motion.

## Architecture decisions

- Clerk manages browser authentication and session cookies; the app stores a lightweight local profile keyed by the Clerk user ID for role and application data.
- Attendance status is determined server-side from the lecture start time, while access is enforced server-side from the teacher-defined attendance window.
- The OpenAPI contract is the single source of truth for both the React Query client and server validation schemas.
- Teacher and student experiences share the same app shell but receive role-specific dashboard summaries and actions.

## Product

- Public product landing page with branded sign in and sign up.
- First-login role setup for teacher or student profiles.
- Teachers can create classes, share generated class codes, publish lectures, set attendance open/close times, and review attendance rosters.
- Students can join classes with a code, view upcoming lectures, and mark attendance only while the attendance window is open.
- Dashboard summaries show class totals, lecture totals, upcoming lectures, attendance rate, present marks, and late marks.

## User preferences

- Use React and Node for the application.

## Gotchas

- Run API codegen after changing `lib/api-spec/openapi.yaml`.
- Web auth uses Clerk session cookies; do not add bearer-token handling to browser API requests.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
