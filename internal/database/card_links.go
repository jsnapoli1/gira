package database

import (
	"fmt"

	"github.com/jsnapoli/gira/internal/models"
)

// CreateCardLink creates a link between two cards.
func (d *DB) CreateCardLink(sourceCardID, targetCardID int64, linkType string, createdBy int64) (*models.CardLink, error) {
	result, err := d.Exec(
		`INSERT INTO card_links (source_card_id, target_card_id, link_type, created_by) VALUES (?, ?, ?, ?)`,
		sourceCardID, targetCardID, linkType, createdBy,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create card link: %w", err)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("failed to get card link ID: %w", err)
	}

	var link models.CardLink
	err = d.QueryRow(
		`SELECT id, source_card_id, target_card_id, link_type, created_by, created_at FROM card_links WHERE id = ?`,
		id,
	).Scan(&link.ID, &link.SourceCardID, &link.TargetCardID, &link.LinkType, &link.CreatedBy, &link.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to read created card link: %w", err)
	}

	return &link, nil
}

// DeleteCardLink removes a card link by ID.
func (d *DB) DeleteCardLink(id int64) error {
	_, err := d.Exec(`DELETE FROM card_links WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("failed to delete card link: %w", err)
	}
	return nil
}

// GetCardLinks returns all links where the given card is source or target,
// with basic card info populated on the related card.
func (d *DB) GetCardLinks(cardID int64) ([]models.CardLink, error) {
	rows, err := d.Query(
		`SELECT cl.id, cl.source_card_id, cl.target_card_id, cl.link_type, cl.created_by, cl.created_at,
		        sc.id, sc.title, sc.state, sc.priority,
		        tc.id, tc.title, tc.state, tc.priority
		 FROM card_links cl
		 JOIN cards sc ON sc.id = cl.source_card_id
		 JOIN cards tc ON tc.id = cl.target_card_id
		 WHERE cl.source_card_id = ? OR cl.target_card_id = ?
		 ORDER BY cl.created_at DESC`,
		cardID, cardID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get card links: %w", err)
	}
	defer rows.Close()

	var links []models.CardLink
	for rows.Next() {
		var link models.CardLink
		var sc models.Card
		var tc models.Card

		err := rows.Scan(
			&link.ID, &link.SourceCardID, &link.TargetCardID, &link.LinkType, &link.CreatedBy, &link.CreatedAt,
			&sc.ID, &sc.Title, &sc.State, &sc.Priority,
			&tc.ID, &tc.Title, &tc.State, &tc.Priority,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan card link: %w", err)
		}

		link.SourceCard = &sc
		link.TargetCard = &tc
		links = append(links, link)
	}

	if links == nil {
		links = []models.CardLink{}
	}

	return links, nil
}
