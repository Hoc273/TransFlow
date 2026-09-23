# Trang Hướng Dẫn (Guide) — Design Spec

**Ngày:** 2026-09-23
**Phạm vi:** Architectural — hệ thống con mới (public + admin)
**Quyết định đã chốt với user:** Platform Super Admin quản trị | Lưu DB + API backend | Nút AvatarMenu trên Cài đặt (tab mới) | Public full | Markdown + ảnh (paste URL phase 1) | Song ngữ vi/en | Sidebar động | Search + draft/publish | Phương án A Full DB-driven

## 1. Mục tiêu & thành công

- Người chưa đăng nhập nhấn "Hướng dẫn" ở landing navbar → đọc toàn bộ hướng dẫn (sidebar + nội dung), có CTA đăng ký.
- Người đã đăng nhập mở "Hướng dẫn" từ AvatarMenu (ngay trên "Cài đặt", tab mới) → cùng trải nghiệm, không mất workspace.
- Platform Super Admin quản trị toàn bộ nội dung tại `/platform/guides`: CRUD category + article, sắp xếp order, draft/publish, preview.
- Thành công: public đọc được không cần login; admin đăng bài realtime không deploy lại; song ngữ vi/en; search hoạt động.

## 2. Kiến trúc

```
Admin → /platform/guides (PlatformShell + PlatformAdminGuard)
      → /api/platform/guides/** (requirePlatformAdmin, audit sẵn có)
      → Postgres: guide_category + guide_article
Public → GET /api/guides/** (permitAll, chỉ PUBLISHED)
      → /guide + /guide/:slug (lazy route, ngoài AuthGuard)
```

- Backend module mới `com.app.modules.guide` — theo pattern `glossary` (entity/repository/service/controller/dto) + gate `PlatformAdminAccessService.requirePlatformAdmin` như `PlatformController`.
- Frontend: namespace i18n mới `guide`, render Markdown bằng `react-markdown + remark-gfm` (không dùng `dangerouslySetInnerHTML`; chỉ render markdown thuần, ảnh `<img loading="lazy">`).
- Không thêm dependency CMS ngoài. Thêm `react-markdown`, `remark-gfm` vào `frontend/package.json`.

## 3. Data model (Postgres)

### guide_category
- id UUID PK (@UuidGenerator), slug varchar(120) unique not null, title_vi/title_en varchar(200) not null
- order_index int not null default 0, is_published boolean default true
- created_at/updated_at Instant, updated_by UUID nullable
- Index: slug unique, order_index.

### guide_article
- id UUID PK, category_id FK → guide_category not null, slug varchar(160) unique not null
- title_vi/title_en varchar(300) not null, excerpt_vi/excerpt_en varchar(500)
- content_vi/content_en text not null (Markdown, limit 100k chars validate)
- status varchar(20) DRAFT/PUBLISHED default DRAFT
- order_index int default 0, cover_image_url varchar(1000) nullable (phase 1: URL paste tay)
- created_at/updated_at, updated_by UUID nullable
- Index: slug unique, (category_id, order_index), status.

Quy tắc:
- Slug: tự sinh từ titleVi (lowercase, bỏ dấu, `-`), cho phép sửa tay, validate `^[a-z0-9-]+$`, unique toàn bảng.
- Xóa category còn bài → chặn 400 + trả `articleCount`.
- Public API chỉ trả PUBLISHED (cả category is_published=true và article status=PUBLISHED).
- Seed 1 category + 3 bài mẫu vi/en (Bắt đầu, Dịch & lồng tiếng, Batch) qua Flyway/Liquibase migration hoặc `data.sql` — dùng migration SQL để chạy mọi môi trường.

## 4. API backend

Public (thêm `/api/guides/**` vào `SecurityConfig.PUBLIC_PATHS`):
- `GET /api/guides/categories?lang=vi|en` → list category published + đếm bài published (title theo lang, fallback vi).
- `GET /api/guides/articles?categoryId=&q=&lang=` → list published (filter category, search title/excerpt/content ilike).
- `GET /api/guides/articles/:slug?lang=` → chi tiết 1 bài published + category info. Slug lạ → 404 ErrorCode phù hợp.

Admin (`/api/platform/guides/**`, mỗi service call đầu tiên `requirePlatformAdmin(userId)`):
- Categories: `GET /api/platform/guides/categories` (cả draft), `POST`, `PUT /:id`, `DELETE /:id`, `PATCH /:id/move` {direction: UP|DOWN} hoặc {orderIndex}.
- Articles: `GET /api/platform/guides/articles?categoryId=&q=&status=`, `POST` (201), `PUT /:id`, `DELETE /:id`, `PATCH /:id/publish` {status}, `GET /:id/preview` (xem cả DRAFT).
- Envelope `ApiResponse<T>` (code/message/data). Validation `@Valid`, slug pattern, size limits. Audit tự động qua `PlatformAdminAuditFilter` (không code thêm).

## 5. Frontend

### 5.1 Routes (`src/app/router.tsx`)
- `/guide` (public, lazy `GuidePage`) + `/guide/:slug` (cùng component, deep-link). Đặt ngoài `AuthGuard`/`GuestGuard`, cạnh `/legacy-landing`.
- `/platform` children thêm `guides` → lazy `GuideAdminPage` (trong `PlatformShell`, đã có `PlatformAdminGuard` bọc).

### 5.2 Entry points (3 điểm)
1. `LandingNavbar.tsx` center nav + mobile drawer: thêm link `t('nav.guide')` → `/guide`. Thêm key `nav.guide` vào `locales/en|vi/landing.json` ("Hướng dẫn"/"Guide").
2. `AvatarMenu.tsx`: thêm item `<IconBook2> t('guide')` ngay trên item Cài đặt, `to="/guide" target="_blank" rel="noreferrer"`. Thêm key `guide` vào `common.json` ("Hướng dẫn"/"Guide").
3. `PlatformShell.tsx` NAV: thêm `{ to: '/platform/guides', icon: IconBook2, key: 'guides' }` (cả desktop sidebar + mobile strip). Thêm `nav.guides` vào `platform.json`.

### 5.3 Trang `/guide` (`src/pages/guide/GuidePage.tsx` + `src/api/guide.ts` + `src/hooks/useGuide.ts` + `src/types/guide.ts`)
- Layout: header tối giản (Logo + LanguageSwitcher + ThemeToggle + CTA login/register nếu chưa login) + body 2 cột (sidebar 280px sticky + content prose). Mobile: sidebar thành `<details>`/drawer trên cùng.
- Sidebar: fetch categories + articles; nhóm collapsible; item active theo `:slug`; search input lọc client-side (title/excerpt) khi <100 bài, gọi `?q=` khi submit.
- Content: breadcrumb, title, excerpt, meta updatedAt, Markdown render, TOC h2/h3 đơn giản, CTA cuối bài nếu chưa login. States: skeleton, empty, 404 → bài đầu tiên.
- i18n namespace `guide.json` mới cho chrome UI; nội dung chọn theo `i18n.language` (fallback vi). Đăng ký trong `src/i18n/index.ts` (resources + ns).

### 5.4 Trang admin `/platform/guides` (`src/pages/platform/GuideAdminPage.tsx`)
- 2 cột: category list trái (CRUD + lên/xuống order + toggle publish) + article table phải (filter category/q/status; cột title/slug/status/order/updatedAt; actions Sửa/Xoá/Preview/Publish nhanh).
- Editor modal/page: fields titleVi/En, slug (auto + sửa tay), excerptVi/En, category select, order number, status select, coverImageUrl, contentVi/En textarea tab Viết/Xem trước (preview render Markdown ngay).
- Xóa có confirm; xóa category còn bài → hiện lỗi articleCount từ backend.
- Dùng `usePlatformMe` sẵn có để gate; mutation xong `queryClient.invalidateQueries`.

## 6. Phi chức năng
- Bảo mật: public chỉ đọc published; admin mọi write qua requirePlatformAdmin; Markdown render không cho HTML thô (không rehype-raw phase 1) → chống XSS.
- SEO: `document.title` theo bài, meta description từ excerpt.
- Hiệu năng: react-query stale 60s public; lazy route; ảnh lazy.
- Tương thích: dark mode (dùng var theme sẵn), mobile drawer, vi/en.

## 7. Testing
- Backend: `GuideControllerTest` (@WebMvcTest: public slug 200/404, admin không quyền 403, tạo bài 201, xóa category còn bài 400) + `GuideServiceTest` (slug unique, public filter published, move order).
- Frontend vitest: `GuidePage.test.tsx` (sidebar render + search filter + chọn bài), `GuideAdminPage.test.tsx` (optimistic publish toggle gọi API), `AvatarMenu` snapshot có item Guide trên Settings.
- Verify: `mvn test -Dtest=Guide*` (backend-main), `npm test -- guide` + `npm run build` (frontend).

## 8. Ngoài phạm vi phase 1 (YAGNI)
Version history, comment/like, view-count, upload ảnh server, kéo-thả order, TOC highlight scroll-spy, full-text Postgres FTS (dùng ILIKE trước).
