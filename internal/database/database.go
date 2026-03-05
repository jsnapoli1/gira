package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

type DB struct {
	*sql.DB
}

func New() (*DB, error) {
	dbPath := getDBPath()

	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create db directory: %w", err)
	}

	db, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	d := &DB{db}
	if err := d.migrate(); err != nil {
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	return d, nil
}

func getDBPath() string {
	// Check for DB_PATH environment variable first (for Docker)
	if dbPath := os.Getenv("DB_PATH"); dbPath != "" {
		return dbPath
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "zira", "zira.db")
}

func (d *DB) migrate() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			display_name TEXT NOT NULL,
			avatar_url TEXT DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS boards (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			description TEXT DEFAULT '',
			owner_id INTEGER NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (owner_id) REFERENCES users(id)
		)`,
		`CREATE TABLE IF NOT EXISTS columns (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			board_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			position INTEGER NOT NULL,
			state TEXT NOT NULL,
			FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS swimlanes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			board_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			repo_owner TEXT NOT NULL,
			repo_name TEXT NOT NULL,
			designator TEXT NOT NULL,
			position INTEGER NOT NULL,
			color TEXT DEFAULT '#6366f1',
			FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS sprints (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			board_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			goal TEXT DEFAULT '',
			start_date DATETIME,
			end_date DATETIME,
			status TEXT DEFAULT 'planning',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS cards (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			board_id INTEGER NOT NULL,
			swimlane_id INTEGER NOT NULL,
			column_id INTEGER NOT NULL,
			sprint_id INTEGER,
			parent_id INTEGER,
			issue_type TEXT DEFAULT 'task',
			gitea_issue_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			description TEXT DEFAULT '',
			state TEXT NOT NULL,
			story_points INTEGER,
			priority TEXT DEFAULT 'medium',
			due_date DATETIME,
			time_estimate INTEGER,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
			FOREIGN KEY (swimlane_id) REFERENCES swimlanes(id) ON DELETE CASCADE,
			FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE,
			FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE SET NULL,
			FOREIGN KEY (parent_id) REFERENCES cards(id) ON DELETE SET NULL
		)`,
		`CREATE TABLE IF NOT EXISTS board_members (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			board_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			role TEXT DEFAULT 'member',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE(board_id, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS card_assignees (
			card_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			PRIMARY KEY (card_id, user_id),
			FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS sprint_metrics (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sprint_id INTEGER NOT NULL,
			date DATE NOT NULL,
			total_points INTEGER DEFAULT 0,
			completed_points INTEGER DEFAULT 0,
			remaining_points INTEGER DEFAULT 0,
			total_cards INTEGER DEFAULT 0,
			completed_cards INTEGER DEFAULT 0,
			FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
			UNIQUE(sprint_id, date)
		)`,
		`CREATE TABLE IF NOT EXISTS work_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			card_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			time_spent INTEGER NOT NULL,
			date DATE NOT NULL,
			notes TEXT DEFAULT '',
			FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_cards_board ON cards(board_id)`,
		`CREATE INDEX IF NOT EXISTS idx_cards_sprint ON cards(sprint_id)`,
		`CREATE INDEX IF NOT EXISTS idx_cards_swimlane ON cards(swimlane_id)`,
		`CREATE INDEX IF NOT EXISTS idx_sprints_board ON sprints(board_id)`,
		`CREATE INDEX IF NOT EXISTS idx_sprint_metrics_sprint ON sprint_metrics(sprint_id)`,
		// Labels
		`CREATE TABLE IF NOT EXISTS labels (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			board_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			color TEXT DEFAULT '#6366f1',
			FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
			UNIQUE(board_id, name)
		)`,
		`CREATE TABLE IF NOT EXISTS card_labels (
			card_id INTEGER NOT NULL,
			label_id INTEGER NOT NULL,
			PRIMARY KEY (card_id, label_id),
			FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
			FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
		)`,
	}

	// Comments table
	migrations = append(migrations, `CREATE TABLE IF NOT EXISTS comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		card_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		body TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`)
	migrations = append(migrations, `CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id)`)

	// Attachments table
	migrations = append(migrations, `CREATE TABLE IF NOT EXISTS attachments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		card_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		filename TEXT NOT NULL,
		size INTEGER NOT NULL,
		mime_type TEXT NOT NULL,
		store_path TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`)
	migrations = append(migrations, `CREATE INDEX IF NOT EXISTS idx_attachments_card ON attachments(card_id)`)


	// Custom fields
	migrations = append(migrations, `CREATE TABLE IF NOT EXISTS custom_field_definitions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		board_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		field_type TEXT NOT NULL,
		options TEXT,
		required INTEGER DEFAULT 0,
		position INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
		UNIQUE(board_id, name)
	)`)
	migrations = append(migrations, `CREATE TABLE IF NOT EXISTS custom_field_values (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		card_id INTEGER NOT NULL,
		field_id INTEGER NOT NULL,
		value TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
		FOREIGN KEY (field_id) REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
		UNIQUE(card_id, field_id)
	)`)
	migrations = append(migrations, `CREATE INDEX IF NOT EXISTS idx_custom_field_values_card ON custom_field_values(card_id)`)
	migrations = append(migrations, `CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_board ON custom_field_definitions(board_id)`)

	// Notifications
	migrations = append(migrations, `CREATE TABLE IF NOT EXISTS notifications (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		type TEXT NOT NULL,
		title TEXT NOT NULL,
		message TEXT NOT NULL,
		link TEXT,
		read INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`)
	migrations = append(migrations, `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`)
	migrations = append(migrations, `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read)`)

	for _, m := range migrations {
		if _, err := d.Exec(m); err != nil {
			return fmt.Errorf("migration failed: %w\nSQL: %s", err, m)
		}
	}

	// Add columns that may already exist in old databases (ignore errors)
	d.Exec(`ALTER TABLE cards ADD COLUMN parent_id INTEGER REFERENCES cards(id) ON DELETE SET NULL`)
	d.Exec(`ALTER TABLE cards ADD COLUMN issue_type TEXT DEFAULT 'task'`)
	d.Exec(`CREATE INDEX IF NOT EXISTS idx_cards_parent ON cards(parent_id)`)
	d.Exec(`ALTER TABLE cards ADD COLUMN due_date DATETIME`)
	d.Exec(`ALTER TABLE cards ADD COLUMN time_estimate INTEGER`)

	return nil
}
