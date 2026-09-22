# Mobile UI Adaptation & Independent Directory Architecture Specification

- **Date:** 2026-09-19
- **Status:** Approved / In Review
- **Target Branch:** `feature/frontend-mobile`
- **Scope:** Complete mobile viewport adaptation for TransFlow Workspace (`/w/:workspaceId/*`) while keeping desktop code completely intact and isolating mobile implementation in `frontend/src/mobile/`.

---

## 1. Overview & Goals

### 1.1 Goals
1. **Touch-First Mobile Experience:** Deliver an ergonomic, responsive, and mobile-optimized user experience for TransFlow on small viewports (< 768px).
2. **Feature Parity:** Retain 100% of existing functionality, data fields, actions, and filters from the desktop web application—no features omitted or simplified out of existence.
3. **Isolated Codebase in `src/mobile/`:** House all mobile-specific pages, layouts, and components in `frontend/src/mobile/` to avoid disrupting or polluting existing desktop code.
4. **Seamless Adaptive Delivery:** Serve both desktop and mobile on identical URLs (`/w/:workspaceId/...`) using automatic viewport detection (`< 768px`).
5. **Media Studio Invariant:** Explicitly exempt `MediaJobPage` (`/w/:workspaceId/media/jobs/:jobId`) from layout changes—render the original desktop studio component directly on mobile devices as requested.
6. **Unified Data Layer:** Leverage existing TanStack Query hooks, Zustand stores (`useAuthStore`, `useUiStore`), and i18next translation keys directly without duplicating business logic or API contracts.

### 1.2 Non-Goals
- Modifying desktop components in place with complex conditional Tailwind classes.
- Reworking backend APIs or data models.
- Changing Public/Landing pages or Platform Super Admin pages in this phase.

---

## 2. Architecture & File Structure

All newly created mobile-specific code will live strictly inside `frontend/src/mobile/`.

```text
frontend/src/mobile/
├── components/
│   ├── BottomSheet.tsx              # Slide-up touch drawer for forms and sub-menus
│   ├── MobileActionMenu.tsx         # Bottom-sheet action list (Edit, Delete, Duplicate)
│   ├── MobileCard.tsx               # Base touch-friendly card component
│   ├── MobileEmptyState.tsx         # Compact empty state
│   └── MobileSearchFilter.tsx       # Expandable search input with filter chips
├── hooks/
│   └── useIsMobile.ts               # Viewport detection hook (< 768px) with matchMedia
├── layout/
│   ├── MobileAppShell.tsx           # Mobile master shell (Header + Content + BottomNav + MenuDrawer)
│   ├── MobileHeader.tsx             # 56px sticky top bar (WorkspaceSwitcher, Search, Notify, Avatar)
│   ├── MobileBottomNav.tsx          # 5-tab sticky bottom navigation bar
│   └── MobileMenuDrawer.tsx         # Slide-out navigation drawer for secondary links
├── pages/
│   ├── account/
│   │   └── MobileAccountPage.tsx    # Touch-friendly settings & profile management
│   ├── batches/
│   │   ├── MobileBatchDetailPage.tsx# Batch detail with expandable item cards
│   │   └── MobileBatchListPage.tsx  # Batch list with progress rings/bars
│   ├── dashboard/
│   │   ├── MobileDashboardPage.tsx  # KPI summary cards and recent activity feed
│   │   └── MobileUsagePage.tsx      # Quota usage and resource bars
│   ├── glossary/
│   │   └── MobileGlossaryPage.tsx   # Bilingual term pairs with search & import/export sheets
│   ├── media/
│   │   └── MobileMediaListPage.tsx  # Media hub with cards, duration badges, and status tabs
│   ├── notification/
│   │   └── MobileNotificationPage.tsx # Notification feed with one-tap read actions
│   ├── projects/
│   │   └── MobileProjectListPage.tsx# Project cards, creation bottom sheet, and action menu
│   └── settings/
│       ├── MobileMembersPage.tsx    # Member list cards with role management
│       └── MobilePresetSettingsPage.tsx # Preset cards and parameter review sheet
└── routes/
    └── MobileWorkspaceAdapter.tsx   # Thin adaptive switcher mounted at AppShell boundary
```

---

## 3. Viewport Detection & Adaptive Routing

### 3.1 Detection Hook: `useIsMobile`
- Evaluates `window.matchMedia('(max-width: 767px)')`.
- Attaches an event listener for live resize and orientation changes.
- Uses `debounce` or immediate state update with SSR/test safety fallback.

### 3.2 Adaptive Switcher: `MobileWorkspaceAdapter`
- Integrates at the `AppShell` or page boundary in `frontend/src/app/router.tsx` or a wrapper component.
- When `isMobile === false`: Renders the existing `AppShell` and original desktop page components.
- When `isMobile === true`:
  - For route `media/jobs/:jobId`: **Always** renders original `MediaJobPage` as-is.
  - For all other `/w/:workspaceId/*` routes: Renders `MobileAppShell` with the corresponding mobile page in `src/mobile/pages/`.

---

## 4. Mobile Shell & Navigation Architecture

### 4.1 Header (`MobileHeader`)
- Fixed at top ($56\text{px}$, `z-40`, backdrop-blur border-b).
- Contains:
  - Brand Logo + Compact `WorkspaceSwitcher`.
  - Quick action icons: Global Search trigger, Notification bell with unread badge counter, and User Avatar.

### 4.2 Bottom Navigation Bar (`MobileBottomNav`)
- Fixed at bottom ($64\text{px}$ + `env(safe-area-inset-bottom)`), thumb-reachable.
- 5 Core tabs:
  1. **Dashboard** (`IconLayoutDashboard`) -> `/w/:workspaceId`
  2. **Projects** (`IconFolder`) -> `/w/:workspaceId/projects`
  3. **Batches** (`IconLayersLinked`) -> `/w/:workspaceId/batches`
  4. **Media** (`IconVideo`) -> `/w/:workspaceId/media`
  5. **Menu ("More")** (`IconMenu2`) -> Opens `MobileMenuDrawer`

### 4.3 Menu Drawer (`MobileMenuDrawer`)
- Slide-out bottom sheet or side drawer containing secondary routes:
  - Glossaries (`/w/:workspaceId/glossaries`)
  - Usage & Quota (`/w/:workspaceId/dashboard/usage`)
  - Workspace Members (`/w/:workspaceId/settings/members`)
  - Workflow Presets (`/w/:workspaceId/media/presets`)
  - Account Profile & Security (`/w/:workspaceId/account/profile`)
  - Theme Switcher (Dark / Light)
  - Logout button

---

## 5. Mobile Page Implementations (100% Feature Parity)

### 5.1 Dashboard & Usage
- **MobileDashboardPage:**
  - KPI cards transformed into a responsive 2x2 grid or carousel.
  - Action buttons (Create Project, Upload Media, New Batch) as high-contrast touch tiles.
  - Recent activity rendered as a vertical feed of `MobileCard`s with timestamps and `StatusBadge`.
- **MobileUsagePage:**
  - Quota limits rendered as full-width progress bars with clear numerical indicators.

### 5.2 Projects (`MobileProjectListPage`)
- Search bar with collapsible status/language filter chips.
- Project items rendered as rich cards: Project name, source/target languages, progress bar percentage, document count, and kebab menu (3-dots) opening `MobileActionMenu`.
- Create Project modal adapted into a full-height `BottomSheet`.

### 5.3 Batches (`MobileBatchListPage` & `MobileBatchDetailPage`)
- **List:** Stacked cards displaying batch title, status badge, progress percentage, total vs completed items.
- **Detail:** Sticky header summary (overall progress and status) with an accordion/list of individual documents. Inline actions for Rerun, Cancel, and Download.

### 5.4 Glossaries (`MobileGlossaryPage`)
- Search input with horizontal scrolling language filter pills.
- Term pair cards: `[Source Term] -> [Target Term]`, context note, POS tag, and edit/delete touch targets.
- Import/Export triggered via a clean bottom action sheet.

### 5.5 Media Hub (`MobileMediaListPage`)
- Horizontal scrolling status filter tabs: *All*, *Active*, *Completed*, *Failed*.
- Media item cards: 16:9 thumbnail preview, duration badge, title, source/target language pill, and real-time processing progress bar.
- Tapping any media card navigates directly to `/w/:workspaceId/media/jobs/:jobId` (which renders the preserved `MediaJobPage`).
- Prominent Upload Media action button.

### 5.6 Settings (Members & Presets)
- **MobileMembersPage:** User cards with avatar, name, email, current role badge, and role change / remove actions. Invite member via `BottomSheet`.
- **MobilePresetSettingsPage:** Preset cards detailing default provider, voice profile, and pipeline parameters.

### 5.7 Notifications & Account
- **MobileNotificationPage:** Chronological notification list with swipe/tap to mark read and filter by type.
- **MobileAccountPage:** Mobile-native grouped settings list (Profile, Security, Preferences, Language, Dark Mode).

---

## 6. Media Studio Exemption Invariant

```tsx
// Guarantee: MediaJobPage is never substituted on mobile
if (isMediaStudioDetailRoute(pathname)) {
  return <MediaJobPage />
}
```
The complex media timeline, subtitle editor, video canvas, and audio mixer in `MediaJobPage` remain 100% untouched.

---

## 7. Quality Assurance & Testing Plan

1. **Unit & Component Tests (`vitest`):**
   - Test `useIsMobile` hook with simulated matchMedia queries.
   - Test `MobileWorkspaceAdapter` rendering correct shell based on viewport width.
   - Test `MobileBottomNav` active tab highlighting and drawer trigger.
   - Test `MobileCard` and `BottomSheet` open/close interactions.
2. **Visual & Responsive Verification:**
   - Verify viewport widths: 375px (iPhone SE), 390px (iPhone 14/15), 412px (Pixel/Galaxy), and tablet breakpoint 768px.
   - Verify desktop view remains completely unaffected at 1024px, 1280px, and 1440px+.
3. **Linting & Build:**
   - Ensure clean TypeScript compilation (`tsc -b`) and zero oxlint violations.
