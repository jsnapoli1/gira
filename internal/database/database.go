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

	db.SetMaxOpenConns(1)

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

	// Card position for ordering within columns/backlog
	d.Exec(`ALTER TABLE cards ADD COLUMN position REAL DEFAULT 0`)
	d.Exec(`CREATE INDEX IF NOT EXISTS idx_cards_position ON cards(board_id, column_id, position)`)
	// Initialize existing cards' position based on created_at order
	d.Exec(`UPDATE cards SET position = (
		SELECT COUNT(*) * 1000 FROM cards c2
		WHERE c2.board_id = cards.board_id
		AND c2.column_id = cards.column_id
		AND c2.created_at <= cards.created_at
	) WHERE position = 0 OR position IS NULL`)

	// Add is_admin column to users (ignore error if already exists)
	d.Exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`)

	// Add comment_id to attachments for linking images to comments
	d.Exec(`ALTER TABLE attachments ADD COLUMN comment_id INTEGER REFERENCES comments(id) ON DELETE SET NULL`)
	d.Exec(`CREATE INDEX IF NOT EXISTS idx_attachments_comment ON attachments(comment_id)`)

	// Card links table
	d.Exec(`CREATE TABLE IF NOT EXISTS card_links (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		source_card_id INTEGER NOT NULL,
		target_card_id INTEGER NOT NULL,
		link_type TEXT NOT NULL,
		created_by INTEGER NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (source_card_id) REFERENCES cards(id) ON DELETE CASCADE,
		FOREIGN KEY (target_card_id) REFERENCES cards(id) ON DELETE CASCADE,
		FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
		UNIQUE(source_card_id, target_card_id, link_type)
	)`)
	d.Exec(`CREATE INDEX IF NOT EXISTS idx_card_links_source ON card_links(source_card_id)`)
	d.Exec(`CREATE INDEX IF NOT EXISTS idx_card_links_target ON card_links(target_card_id)`)

	// Add multi-repo support columns to swimlanes (ignore errors if already exist)
	d.Exec(`ALTER TABLE swimlanes ADD COLUMN repo_source TEXT DEFAULT 'default_gitea'`)
	d.Exec(`ALTER TABLE swimlanes ADD COLUMN repo_url TEXT DEFAULT ''`)

	// Create swimlane_credentials table for storing API tokens
	d.Exec(`CREATE TABLE IF NOT EXISTS swimlane_credentials (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		swimlane_id INTEGER UNIQUE NOT NULL,
		api_token TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (swimlane_id) REFERENCES swimlanes(id) ON DELETE CASCADE
	)`)

	// Create user_credentials table for user-level API credentials
	d.Exec(`CREATE TABLE IF NOT EXISTS user_credentials (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		provider TEXT NOT NULL,
		provider_url TEXT DEFAULT '',
		api_token TEXT NOT NULL,
		display_name TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		UNIQUE(user_id, provider, provider_url)
	)`)
	d.Exec(`CREATE INDEX IF NOT EXISTS idx_user_credentials_user ON user_credentials(user_id)`)

	// Activity log
	d.Exec(`CREATE TABLE IF NOT EXISTS activity_log (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		board_id INTEGER NOT NULL,
		card_id INTEGER,
		user_id INTEGER NOT NULL,
		action TEXT NOT NULL,
		entity_type TEXT NOT NULL,
		field_changed TEXT,
		old_value TEXT,
		new_value TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
		FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`)
	d.Exec(`CREATE INDEX IF NOT EXISTS idx_activity_log_card ON activity_log(card_id)`)
	d.Exec(`CREATE INDEX IF NOT EXISTS idx_activity_log_board ON activity_log(board_id)`)
	d.Exec(`CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC)`)

	// Bootstrap: If no admins exist and users exist, promote first user to admin
	var adminCount int
	d.QueryRow(`SELECT COUNT(*) FROM users WHERE is_admin = 1`).Scan(&adminCount)
	if adminCount == 0 {
		var userCount int
		d.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&userCount)
		if userCount > 0 {
			d.Exec(`UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)`)
		}
	}

	return nil
}
