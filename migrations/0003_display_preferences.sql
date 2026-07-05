ALTER TABLE user_profile ADD COLUMN enable_preview_images INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_profile ADD COLUMN bookmark_description_display TEXT NOT NULL DEFAULT 'separate';
ALTER TABLE user_profile ADD COLUMN bookmark_description_max_lines INTEGER NOT NULL DEFAULT 3;
