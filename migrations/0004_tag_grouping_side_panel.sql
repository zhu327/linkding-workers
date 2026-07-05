ALTER TABLE user_profile ADD COLUMN tag_grouping TEXT NOT NULL DEFAULT 'disabled';
ALTER TABLE user_profile ADD COLUMN collapse_side_panel INTEGER NOT NULL DEFAULT 0;
