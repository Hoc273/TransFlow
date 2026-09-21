-- V7: Add is_platform_admin column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Ensure default Super Admin has is_platform_admin = TRUE
UPDATE users SET is_platform_admin = TRUE WHERE email = 'admin@transflow.com';
