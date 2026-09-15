-- V3__seed_terms_version.sql
-- Media Asset & Consent (Backend_Java_TaskSplit_MemberB.md §2.1) cần đúng 1 terms_version hiện hành
-- để GET .../media/terms-version và POST .../consent hoạt động ngay từ đầu.

INSERT INTO terms_versions (version, content_ref, is_current, published_at)
VALUES ('v1', 'terms/v1.md', true, now());
