// Package storage provides share-related database operations.
package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"math/big"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Share represents a public share link.
type Share struct {
	ID           string     `json:"id"`
	Type         string     `json:"type"`
	PhotoID      *string    `json:"photo_id,omitempty"`
	AlbumID      *string    `json:"album_id,omitempty"`
	Code         string     `json:"code"`
	HasPassword  bool       `json:"has_password"`
	PasswordHash *string    `json:"-"` // Never expose in JSON
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	ViewCount    int        `json:"view_count"`
	CreatedAt    time.Time  `json:"created_at"`
}

// CreateShareParams contains parameters for creating a share.
type CreateShareParams struct {
	Type        string // "photo" or "album"
	PhotoID     *string
	AlbumID     *string
	Password    *string
	ExpiresDays *int
}

// ListShares returns all share links.
func (s *Storage) ListShares(ctx context.Context) ([]Share, error) {
	query := `
		SELECT id, type, photo_id, album_id, id as code, password_hash IS NOT NULL as has_password, expires_at, view_count, created_at
		FROM shares
		ORDER BY created_at DESC
	`

	rows, err := s.db.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query shares: %w", err)
	}
	defer rows.Close()

	var shares []Share
	for rows.Next() {
		var sh Share
		var photoID, albumID sql.NullString
		var expiresAt sql.NullTime

		if err := rows.Scan(&sh.ID, &sh.Type, &photoID, &albumID, &sh.Code, &sh.HasPassword, &expiresAt, &sh.ViewCount, &sh.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan share: %w", err)
		}

		if photoID.Valid {
			sh.PhotoID = &photoID.String
		}
		if albumID.Valid {
			sh.AlbumID = &albumID.String
		}
		if expiresAt.Valid {
			sh.ExpiresAt = &expiresAt.Time
		}

		shares = append(shares, sh)
	}

	return shares, nil
}

// CreateShare creates a new share link.
func (s *Storage) CreateShare(ctx context.Context, params CreateShareParams) (*Share, error) {
	code := generateShareCode()

	var passwordHash sql.NullString
	if params.Password != nil && *params.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*params.Password), bcrypt.DefaultCost)
		if err != nil {
			return nil, fmt.Errorf("hash password: %w", err)
		}
		passwordHash = sql.NullString{String: string(hash), Valid: true}
	}

	var expiresAt sql.NullTime
	if params.ExpiresDays != nil && *params.ExpiresDays > 0 {
		exp := time.Now().AddDate(0, 0, *params.ExpiresDays)
		expiresAt = sql.NullTime{Time: exp, Valid: true}
	}

	var photoID, albumID sql.NullString
	if params.PhotoID != nil {
		photoID = sql.NullString{String: *params.PhotoID, Valid: true}
	}
	if params.AlbumID != nil {
		albumID = sql.NullString{String: *params.AlbumID, Valid: true}
	}

	_, err := s.db.Exec(ctx, `
		INSERT INTO shares (id, type, photo_id, album_id, password_hash, expires_at, view_count, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 0, NOW())
	`, code, params.Type, photoID, albumID, passwordHash, expiresAt)
	if err != nil {
		return nil, fmt.Errorf("create share: %w", err)
	}

	share := &Share{
		ID:          code,
		Type:        params.Type,
		PhotoID:     params.PhotoID,
		AlbumID:     params.AlbumID,
		Code:        code,
		HasPassword: passwordHash.Valid,
		ViewCount:   0,
		CreatedAt:   time.Now(),
	}
	if expiresAt.Valid {
		share.ExpiresAt = &expiresAt.Time
	}

	return share, nil
}

// GetShareByCode returns a share by its code.
func (s *Storage) GetShareByCode(ctx context.Context, code string) (*Share, error) {
	query := `
		SELECT id, type, photo_id, album_id, password_hash, expires_at, view_count, created_at
		FROM shares
		WHERE id = $1
	`

	var sh Share
	var photoID, albumID, passwordHash sql.NullString
	var expiresAt sql.NullTime

	err := s.db.QueryRow(ctx, query, code).Scan(
		&sh.ID, &sh.Type, &photoID, &albumID, &passwordHash, &expiresAt, &sh.ViewCount, &sh.CreatedAt,
	)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("query share: %w", err)
	}

	sh.Code = sh.ID
	sh.HasPassword = passwordHash.Valid

	if photoID.Valid {
		sh.PhotoID = &photoID.String
	}
	if albumID.Valid {
		sh.AlbumID = &albumID.String
	}
	if passwordHash.Valid {
		sh.PasswordHash = &passwordHash.String
	}
	if expiresAt.Valid {
		sh.ExpiresAt = &expiresAt.Time
	}

	return &sh, nil
}

// DeleteShare deletes a share link.
func (s *Storage) DeleteShare(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, "DELETE FROM shares WHERE id = $1", id)
	return err
}

// IncrementShareViewCount increments the view count of a share.
func (s *Storage) IncrementShareViewCount(ctx context.Context, code string) error {
	_, err := s.db.Exec(ctx, "UPDATE shares SET view_count = view_count + 1 WHERE id = $1", code)
	return err
}

// ValidateSharePassword checks if the provided password matches the share's password.
func ValidateSharePassword(share *Share, password string) bool {
	if share.PasswordHash == nil {
		return true // No password required
	}
	return bcrypt.CompareHashAndPassword([]byte(*share.PasswordHash), []byte(password)) == nil
}

// IsShareExpired checks if a share has expired.
func IsShareExpired(share *Share) bool {
	if share.ExpiresAt == nil {
		return false
	}
	return time.Now().After(*share.ExpiresAt)
}

// generateShareCode generates a random 8-character alphanumeric code.
func generateShareCode() string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	result := make([]byte, 8)
	for i := range result {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		result[i] = chars[n.Int64()]
	}
	return string(result)
}
