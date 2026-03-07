package database

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/jsnapoli/zira/internal/models"
)

func (d *DB) CreateSprint(boardID int64, name, goal string, startDate, endDate *time.Time) (*models.Sprint, error) {
	result, err := d.Exec(
		`INSERT INTO sprints (board_id, name, goal, start_date, end_date, status)
		 VALUES (?, ?, ?, ?, ?, 'planning')`,
		boardID, name, goal, startDate, endDate,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create sprint: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get last insert ID: %w", err)
	}
	return d.GetSprintByID(id)
}

func (d *DB) GetSprintByID(id int64) (*models.Sprint, error) {
	var sprint models.Sprint
	var startDate, endDate sql.NullTime

	err := d.QueryRow(
		`SELECT id, board_id, name, goal, start_date, end_date, status, created_at, updated_at
		 FROM sprints WHERE id = ?`,
		id,
	).Scan(&sprint.ID, &sprint.BoardID, &sprint.Name, &sprint.Goal, &startDate, &endDate, &sprint.Status, &sprint.CreatedAt, &sprint.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get sprint: %w", err)
	}

	if startDate.Valid {
		sprint.StartDate = &startDate.Time
	}
	if endDate.Valid {
		sprint.EndDate = &endDate.Time
	}

	return &sprint, nil
}

func (d *DB) ListSprintsForBoard(boardID int64) ([]models.Sprint, error) {
	rows, err := d.Query(
		`SELECT id, board_id, name, goal, start_date, end_date, status, created_at, updated_at
		 FROM sprints WHERE board_id = ? ORDER BY created_at DESC`,
		boardID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list sprints: %w", err)
	}
	defer rows.Close()

	var sprints []models.Sprint
	for rows.Next() {
		var sprint models.Sprint
		var startDate, endDate sql.NullTime

		if err := rows.Scan(&sprint.ID, &sprint.BoardID, &sprint.Name, &sprint.Goal, &startDate, &endDate, &sprint.Status, &sprint.CreatedAt, &sprint.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan sprint: %w", err)
		}

		if startDate.Valid {
			sprint.StartDate = &startDate.Time
		}
		if endDate.Valid {
			sprint.EndDate = &endDate.Time
		}

		sprints = append(sprints, sprint)
	}

	return sprints, nil
}

func (d *DB) GetActiveSprint(boardID int64) (*models.Sprint, error) {
	var sprint models.Sprint
	var startDate, endDate sql.NullTime

	err := d.QueryRow(
		`SELECT id, board_id, name, goal, start_date, end_date, status, created_at, updated_at
		 FROM sprints WHERE board_id = ? AND status = 'active'`,
		boardID,
	).Scan(&sprint.ID, &sprint.BoardID, &sprint.Name, &sprint.Goal, &startDate, &endDate, &sprint.Status, &sprint.CreatedAt, &sprint.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get active sprint: %w", err)
	}

	if startDate.Valid {
		sprint.StartDate = &startDate.Time
	}
	if endDate.Valid {
		sprint.EndDate = &endDate.Time
	}

	return &sprint, nil
}

func (d *DB) UpdateSprint(sprint *models.Sprint) error {
	_, err := d.Exec(
		`UPDATE sprints SET name = ?, goal = ?, start_date = ?, end_date = ?, status = ?, updated_at = ?
		 WHERE id = ?`,
		sprint.Name, sprint.Goal, sprint.StartDate, sprint.EndDate, sprint.Status, time.Now(), sprint.ID,
	)
	if err != nil {
		return fmt.Errorf("failed to update sprint: %w", err)
	}
	return nil
}

func (d *DB) StartSprint(sprintID int64) error {
	now := time.Now()
	_, err := d.Exec(
		`UPDATE sprints SET status = 'active', start_date = COALESCE(start_date, ?), updated_at = ?
		 WHERE id = ?`,
		now, now, sprintID,
	)
	return err
}

func (d *DB) CompleteSprint(sprintID int64) error {
	now := time.Now()
	_, err := d.Exec(
		`UPDATE sprints SET status = 'completed', end_date = ?, updated_at = ?
		 WHERE id = ?`,
		now, now, sprintID,
	)
	return err
}

func (d *DB) DeleteSprint(id int64) error {
	_, err := d.Exec(`DELETE FROM sprints WHERE id = ?`, id)
	return err
}

// Sprint metrics

func (d *DB) RecordSprintMetrics(sprintID int64, metrics models.SprintMetrics) error {
	_, err := d.Exec(
		`INSERT OR REPLACE INTO sprint_metrics
		 (sprint_id, date, total_points, completed_points, remaining_points, total_cards, completed_cards)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		sprintID, metrics.Date, metrics.TotalPoints, metrics.CompletedPoints, metrics.RemainingPoints, metrics.TotalCards, metrics.CompletedCards,
	)
	return err
}

func (d *DB) GetSprintMetrics(sprintID int64) ([]models.SprintMetrics, error) {
	rows, err := d.Query(
		`SELECT sprint_id, date, total_points, completed_points, remaining_points, total_cards, completed_cards
		 FROM sprint_metrics WHERE sprint_id = ? ORDER BY date`,
		sprintID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var metrics []models.SprintMetrics
	for rows.Next() {
		var m models.SprintMetrics
		if err := rows.Scan(&m.SprintID, &m.Date, &m.TotalPoints, &m.CompletedPoints, &m.RemainingPoints, &m.TotalCards, &m.CompletedCards); err != nil {
			return nil, err
		}
		metrics = append(metrics, m)
	}
	return metrics, nil
}

func (d *DB) CalculateCurrentSprintMetrics(sprintID int64) (*models.SprintMetrics, error) {
	var m models.SprintMetrics
	m.SprintID = sprintID
	m.Date = time.Now()

	// Get total cards and points
	err := d.QueryRow(
		`SELECT COUNT(*), COALESCE(SUM(story_points), 0)
		 FROM cards WHERE sprint_id = ?`,
		sprintID,
	).Scan(&m.TotalCards, &m.TotalPoints)
	if err != nil {
		return nil, err
	}

	// Get completed cards and points
	err = d.QueryRow(
		`SELECT COUNT(*), COALESCE(SUM(story_points), 0)
		 FROM cards WHERE sprint_id = ? AND state = 'closed'`,
		sprintID,
	).Scan(&m.CompletedCards, &m.CompletedPoints)
	if err != nil {
		return nil, err
	}

	m.RemainingPoints = m.TotalPoints - m.CompletedPoints
	return &m, nil
}
