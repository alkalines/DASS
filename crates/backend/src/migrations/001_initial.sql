CREATE TABLE metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    display_name TEXT
) STRICT;
CREATE TABLE administrators (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL
) STRICT;
CREATE TABLE invites (
    invite_id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    display_name TEXT
) STRICT;
