// Package storage provides people-related database operations.
// Handles persons, faces, and people groups for AI face recognition features.
package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"
)

// =============================================================================
// Types
// =============================================================================

// Person represents a person identified by AI face recognition.
type Person struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	NameSource  string    `json:"name_source"` // "auto" or "manual"
	CoverFaceID *string   `json:"cover_face_id,omitempty"`
	PhotoCount  int       `json:"photo_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// PersonWithCover includes person data with cover photo info for preview.
type PersonWithCover struct {
	Person
	CoverPhotoID *string  `json:"cover_photo_id,omitempty"` // Photo ID for URL generation
	CoverBox     *FaceBox `json:"cover_box,omitempty"`      // Bounding box for face crop
}

// FaceBox represents face bounding box coordinates (relative 0.0-1.0).
type FaceBox struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// Face represents a face embedding belonging to a person.
type Face struct {
	ID         string    `json:"id"`
	PersonID   string    `json:"person_id"`
	PhotoCount int       `json:"photo_count"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// FaceWithPreview includes face data with preview photo info.
type FaceWithPreview struct {
	Face
	PreviewPhotoID string  `json:"preview_photo_id"`
	PreviewBox     FaceBox `json:"preview_box"`
}

// PeopleGroup represents a group of 2+ persons appearing together in photos.
type PeopleGroup struct {
	PersonIDs  []string `json:"person_ids"`
	PhotoCount int      `json:"photo_count"`
}

// PeopleGroupWithNames includes group data with person names.
type PeopleGroupWithNames struct {
	PeopleGroup
	Names []string `json:"names"` // Parallel array with PersonIDs
}

// =============================================================================
// List Params
// =============================================================================

// PersonListParams contains parameters for listing persons.
type PersonListParams struct {
	Limit  int
	Offset int
}

// PeopleGroupListParams contains parameters for listing people groups.
type PeopleGroupListParams struct {
	Limit  int
	Offset int
}

// PersonPhotosParams contains parameters for listing person's photos.
type PersonPhotosParams struct {
	PersonID   string
	Limit      int
	Cursor     *PhotoCursor
	HiddenOnly bool // If true, return only hidden photos
}

// GroupPhotosParams contains parameters for listing group photos.
type GroupPhotosParams struct {
	PersonIDs  []string
	Limit      int
	Cursor     *PhotoCursor
	HiddenOnly bool
}

// =============================================================================
// Person Operations
// =============================================================================

// ListPersons returns persons ordered by photo_count descending with pagination.
func (s *Storage) ListPersons(ctx context.Context, params PersonListParams) ([]PersonWithCover, int, error) {
	if params.Limit <= 0 || params.Limit > 100 {
		params.Limit = 15
	}
	if params.Offset < 0 {
		params.Offset = 0
	}

	// Get total count
	var total int
	err := s.db.QueryRow(ctx, "SELECT COUNT(*) FROM persons").Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count persons: %w", err)
	}

	// Get persons with cover info
	query := `
		SELECT
			p.id, p.name, p.name_source, p.cover_face_id, p.photo_count, p.created_at, p.updated_at,
			pf.photo_id as cover_photo_id,
			pf.box_x, pf.box_y, pf.box_w, pf.box_h
		FROM persons p
		LEFT JOIN photo_faces pf ON pf.id = p.cover_face_id
		ORDER BY p.photo_count DESC, p.created_at DESC
		LIMIT $1 OFFSET $2
	`

	rows, err := s.db.Query(ctx, query, params.Limit, params.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query persons: %w", err)
	}
	defer rows.Close()

	var persons []PersonWithCover
	for rows.Next() {
		var p PersonWithCover
		var coverFaceID, coverPhotoID sql.NullString
		var boxX, boxY, boxW, boxH sql.NullFloat64

		err := rows.Scan(
			&p.ID, &p.Name, &p.NameSource, &coverFaceID, &p.PhotoCount, &p.CreatedAt, &p.UpdatedAt,
			&coverPhotoID, &boxX, &boxY, &boxW, &boxH,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("scan person: %w", err)
		}

		if coverFaceID.Valid {
			p.CoverFaceID = &coverFaceID.String
		}
		if coverPhotoID.Valid {
			p.CoverPhotoID = &coverPhotoID.String
			if boxX.Valid {
				p.CoverBox = &FaceBox{
					X: boxX.Float64,
					Y: boxY.Float64,
					W: boxW.Float64,
					H: boxH.Float64,
				}
			}
		}

		// If no cover set, get first photo_face for this person
		if p.CoverPhotoID == nil {
			firstCover, err := s.getFirstPersonCover(ctx, p.ID)
			if err == nil && firstCover != nil {
				p.CoverPhotoID = &firstCover.PhotoID
				p.CoverBox = &firstCover.Box
			}
		}

		persons = append(persons, p)
	}

	return persons, total, nil
}

// personCover holds cover info for a person.
type personCover struct {
	PhotoID string
	Box     FaceBox
}

// getFirstPersonCover returns the first photo face for a person as cover.
func (s *Storage) getFirstPersonCover(ctx context.Context, personID string) (*personCover, error) {
	query := `
		SELECT pf.photo_id, pf.box_x, pf.box_y, pf.box_w, pf.box_h
		FROM photo_faces pf
		JOIN faces f ON f.id = pf.face_id
		WHERE f.person_id = $1 AND pf.hidden = FALSE
		ORDER BY pf.created_at ASC
		LIMIT 1
	`

	var photoID string
	var boxX, boxY, boxW, boxH float64

	err := s.db.QueryRow(ctx, query, personID).Scan(&photoID, &boxX, &boxY, &boxW, &boxH)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, err
	}

	return &personCover{
		PhotoID: photoID,
		Box:     FaceBox{X: boxX, Y: boxY, W: boxW, H: boxH},
	}, nil
}

// GetPerson returns a person by ID.
func (s *Storage) GetPerson(ctx context.Context, id string) (*PersonWithCover, error) {
	query := `
		SELECT
			p.id, p.name, p.name_source, p.cover_face_id, p.photo_count, p.created_at, p.updated_at,
			pf.photo_id as cover_photo_id,
			pf.box_x, pf.box_y, pf.box_w, pf.box_h
		FROM persons p
		LEFT JOIN photo_faces pf ON pf.id = p.cover_face_id
		WHERE p.id = $1
	`

	var p PersonWithCover
	var coverFaceID, coverPhotoID sql.NullString
	var boxX, boxY, boxW, boxH sql.NullFloat64

	err := s.db.QueryRow(ctx, query, id).Scan(
		&p.ID, &p.Name, &p.NameSource, &coverFaceID, &p.PhotoCount, &p.CreatedAt, &p.UpdatedAt,
		&coverPhotoID, &boxX, &boxY, &boxW, &boxH,
	)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("query person: %w", err)
	}

	if coverFaceID.Valid {
		p.CoverFaceID = &coverFaceID.String
	}
	if coverPhotoID.Valid {
		p.CoverPhotoID = &coverPhotoID.String
		if boxX.Valid {
			p.CoverBox = &FaceBox{
				X: boxX.Float64,
				Y: boxY.Float64,
				W: boxW.Float64,
				H: boxH.Float64,
			}
		}
	}

	// If no cover set, get first photo_face
	if p.CoverPhotoID == nil {
		firstCover, err := s.getFirstPersonCover(ctx, p.ID)
		if err == nil && firstCover != nil {
			p.CoverPhotoID = &firstCover.PhotoID
			p.CoverBox = &firstCover.Box
		}
	}

	return &p, nil
}

// UpdatePersonParams contains parameters for updating a person.
type UpdatePersonParams struct {
	Name        *string // New name (sets name_source to "manual")
	CoverFaceID *string // New cover face ID
}

// UpdatePerson updates a person's properties.
func (s *Storage) UpdatePerson(ctx context.Context, id string, params UpdatePersonParams) error {
	// Check person exists
	person, err := s.GetPerson(ctx, id)
	if err != nil {
		return err
	}
	if person == nil {
		return fmt.Errorf("person not found")
	}

	// Build dynamic update query
	sets := []string{}
	args := []interface{}{}
	argNum := 1

	if params.Name != nil {
		sets = append(sets, fmt.Sprintf("name = $%d", argNum))
		args = append(args, *params.Name)
		argNum++
		sets = append(sets, "name_source = 'manual'")
	}

	if params.CoverFaceID != nil {
		if *params.CoverFaceID == "" {
			sets = append(sets, "cover_face_id = NULL")
		} else {
			// Verify cover_face_id belongs to a face of this person
			var count int
			err := s.db.QueryRow(ctx, `
				SELECT COUNT(*) FROM photo_faces pf
				JOIN faces f ON f.id = pf.face_id
				WHERE pf.id = $1 AND f.person_id = $2
			`, *params.CoverFaceID, id).Scan(&count)
			if err != nil {
				return fmt.Errorf("verify cover face: %w", err)
			}
			if count == 0 {
				return fmt.Errorf("cover face does not belong to this person")
			}

			sets = append(sets, fmt.Sprintf("cover_face_id = $%d", argNum))
			args = append(args, *params.CoverFaceID)
			argNum++
		}
	}

	if len(sets) == 0 {
		return nil // Nothing to update
	}

	args = append(args, id)
	query := fmt.Sprintf("UPDATE persons SET %s, updated_at = NOW() WHERE id = $%d",
		strings.Join(sets, ", "), argNum)

	_, err = s.db.Exec(ctx, query, args...)
	return err
}

// DeletePerson deletes a person and all associated faces.
// Photos keep their AI data but the person reference is removed.
func (s *Storage) DeletePerson(ctx context.Context, id string) error {
	// Check person exists
	person, err := s.GetPerson(ctx, id)
	if err != nil {
		return err
	}
	if person == nil {
		return nil // Already deleted
	}

	// Start transaction
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Remove person_id from photos.ai_person_ids
	_, err = tx.Exec(ctx, `
		UPDATE photos
		SET ai_person_ids = array_remove(ai_person_ids, $1)
		WHERE $1 = ANY(ai_person_ids)
	`, id)
	if err != nil {
		return fmt.Errorf("update photos: %w", err)
	}

	// Delete person (cascades to faces -> photo_faces)
	_, err = tx.Exec(ctx, "DELETE FROM persons WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("delete person: %w", err)
	}

	return tx.Commit(ctx)
}

// =============================================================================
// Face Operations
// =============================================================================

// ListPersonFaces returns all faces belonging to a person.
func (s *Storage) ListPersonFaces(ctx context.Context, personID string) ([]FaceWithPreview, error) {
	query := `
		SELECT
			f.id, f.person_id, f.photo_count, f.created_at, f.updated_at,
			pf.photo_id, pf.box_x, pf.box_y, pf.box_w, pf.box_h
		FROM faces f
		LEFT JOIN LATERAL (
			SELECT photo_id, box_x, box_y, box_w, box_h
			FROM photo_faces
			WHERE face_id = f.id AND hidden = FALSE
			ORDER BY created_at ASC
			LIMIT 1
		) pf ON TRUE
		WHERE f.person_id = $1
		ORDER BY f.photo_count DESC, f.created_at ASC
	`

	rows, err := s.db.Query(ctx, query, personID)
	if err != nil {
		return nil, fmt.Errorf("query faces: %w", err)
	}
	defer rows.Close()

	var faces []FaceWithPreview
	for rows.Next() {
		var f FaceWithPreview
		var photoID sql.NullString
		var boxX, boxY, boxW, boxH sql.NullFloat64

		err := rows.Scan(
			&f.ID, &f.PersonID, &f.PhotoCount, &f.CreatedAt, &f.UpdatedAt,
			&photoID, &boxX, &boxY, &boxW, &boxH,
		)
		if err != nil {
			return nil, fmt.Errorf("scan face: %w", err)
		}

		if photoID.Valid {
			f.PreviewPhotoID = photoID.String
			f.PreviewBox = FaceBox{
				X: boxX.Float64,
				Y: boxY.Float64,
				W: boxW.Float64,
				H: boxH.Float64,
			}
		}

		faces = append(faces, f)
	}

	return faces, nil
}

// DetachFace detaches a face from its person and creates a new person for it.
// Returns the new person ID.
func (s *Storage) DetachFace(ctx context.Context, personID, faceID string) (string, error) {
	// Verify face belongs to person
	var count int
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM faces WHERE id = $1 AND person_id = $2
	`, faceID, personID).Scan(&count)
	if err != nil {
		return "", fmt.Errorf("verify face: %w", err)
	}
	if count == 0 {
		return "", fmt.Errorf("face not found or does not belong to person")
	}

	// Check person has more than one face
	err = s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM faces WHERE person_id = $1
	`, personID).Scan(&count)
	if err != nil {
		return "", fmt.Errorf("count faces: %w", err)
	}
	if count <= 1 {
		return "", fmt.Errorf("cannot detach the only face of a person")
	}

	// Start transaction
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Get next unknown number
	var maxNum int
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(
			CASE
				WHEN name ~ '^Unknown [0-9]+$'
				THEN CAST(SUBSTRING(name FROM 'Unknown ([0-9]+)') AS INTEGER)
				ELSE 0
			END
		), 0)
		FROM persons
	`).Scan(&maxNum)
	if err != nil {
		return "", fmt.Errorf("get max unknown: %w", err)
	}

	// Create new person
	newPersonID := generatePersonID()
	newName := fmt.Sprintf("Unknown %d", maxNum+1)

	_, err = tx.Exec(ctx, `
		INSERT INTO persons (id, name, name_source, photo_count, created_at, updated_at)
		VALUES ($1, $2, 'auto', 0, NOW(), NOW())
	`, newPersonID, newName)
	if err != nil {
		return "", fmt.Errorf("create person: %w", err)
	}

	// Get face photo_count before moving
	var facePhotoCount int
	err = tx.QueryRow(ctx, "SELECT photo_count FROM faces WHERE id = $1", faceID).Scan(&facePhotoCount)
	if err != nil {
		return "", fmt.Errorf("get face photo count: %w", err)
	}

	// Move face to new person
	_, err = tx.Exec(ctx, `
		UPDATE faces SET person_id = $1, updated_at = NOW() WHERE id = $2
	`, newPersonID, faceID)
	if err != nil {
		return "", fmt.Errorf("move face: %w", err)
	}

	// Update new person photo_count
	_, err = tx.Exec(ctx, `
		UPDATE persons SET photo_count = $1 WHERE id = $2
	`, facePhotoCount, newPersonID)
	if err != nil {
		return "", fmt.Errorf("update new person count: %w", err)
	}

	// Update old person photo_count
	_, err = tx.Exec(ctx, `
		UPDATE persons SET photo_count = photo_count - $1, updated_at = NOW() WHERE id = $2
	`, facePhotoCount, personID)
	if err != nil {
		return "", fmt.Errorf("update old person count: %w", err)
	}

	// Update photos.ai_person_ids for affected photos
	_, err = tx.Exec(ctx, `
		UPDATE photos
		SET ai_person_ids = array_append(array_remove(ai_person_ids, $1), $2)
		WHERE id IN (
			SELECT DISTINCT pf.photo_id
			FROM photo_faces pf
			WHERE pf.face_id = $3
		)
	`, personID, newPersonID, faceID)
	if err != nil {
		return "", fmt.Errorf("update photo person ids: %w", err)
	}

	// Clear cover_face_id if it was the detached face
	_, err = tx.Exec(ctx, `
		UPDATE persons SET cover_face_id = NULL
		WHERE id = $1 AND cover_face_id IN (
			SELECT id FROM photo_faces WHERE face_id = $2
		)
	`, personID, faceID)
	if err != nil {
		return "", fmt.Errorf("clear cover: %w", err)
	}

	return newPersonID, tx.Commit(ctx)
}

// =============================================================================
// Merge Operations
// =============================================================================

// MergePersonsParams contains parameters for merging persons.
type MergePersonsParams struct {
	SourceIDs  []string // Persons to merge (will be deleted)
	TargetID   string   // Target person (will receive all faces), optional - auto-select if empty
	TargetName *string  // New name for target, optional
}

// MergePersonsResult contains the result of merge operation.
type MergePersonsResult struct {
	TargetID      string `json:"target_id"`
	MergedCount   int    `json:"merged_count"`
	FacesMoved    int    `json:"faces_moved"`
	PhotosUpdated int    `json:"photos_updated"`
}

// MergePersons merges multiple persons into one.
// If TargetID is empty, auto-selects based on: named person > most photos.
func (s *Storage) MergePersons(ctx context.Context, params MergePersonsParams) (*MergePersonsResult, error) {
	if len(params.SourceIDs) < 2 {
		return nil, fmt.Errorf("at least 2 persons required for merge")
	}

	// Get all persons info
	allIDs := params.SourceIDs
	persons := make(map[string]*Person)

	for _, id := range allIDs {
		p, err := s.GetPerson(ctx, id)
		if err != nil {
			return nil, fmt.Errorf("get person %s: %w", id, err)
		}
		if p == nil {
			return nil, fmt.Errorf("person not found: %s", id)
		}
		persons[id] = &p.Person
	}

	// Determine target
	targetID := params.TargetID
	if targetID == "" {
		targetID = s.selectMergeTarget(persons)
	} else {
		// Verify target is in source list
		found := false
		for _, id := range allIDs {
			if id == targetID {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("target_id must be one of source_ids")
		}
	}

	// Check for name conflicts
	if params.TargetName == nil {
		namedPersons := []string{}
		for _, p := range persons {
			if p.NameSource == "manual" {
				namedPersons = append(namedPersons, p.ID)
			}
		}
		if len(namedPersons) > 1 {
			return nil, fmt.Errorf("multiple persons have names, specify target_name")
		}
	}

	// Start transaction
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	result := &MergePersonsResult{
		TargetID:    targetID,
		MergedCount: len(allIDs) - 1,
	}

	// Source IDs (all except target)
	sourceIDs := []string{}
	for _, id := range allIDs {
		if id != targetID {
			sourceIDs = append(sourceIDs, id)
		}
	}

	// Move all faces to target person
	res, err := tx.Exec(ctx, `
		UPDATE faces SET person_id = $1, updated_at = NOW()
		WHERE person_id = ANY($2)
	`, targetID, sourceIDs)
	if err != nil {
		return nil, fmt.Errorf("move faces: %w", err)
	}
	result.FacesMoved = int(res.RowsAffected())

	// Update photos.ai_person_ids: replace source IDs with target ID
	for _, sourceID := range sourceIDs {
		res, err := tx.Exec(ctx, `
			UPDATE photos
			SET ai_person_ids = (
				SELECT array_agg(DISTINCT CASE WHEN pid = $1 THEN $2 ELSE pid END)
				FROM unnest(ai_person_ids) AS pid
			)
			WHERE $1 = ANY(ai_person_ids)
		`, sourceID, targetID)
		if err != nil {
			return nil, fmt.Errorf("update photo person ids: %w", err)
		}
		result.PhotosUpdated += int(res.RowsAffected())
	}

	// Update target person name if specified
	if params.TargetName != nil {
		_, err = tx.Exec(ctx, `
			UPDATE persons SET name = $1, name_source = 'manual', updated_at = NOW()
			WHERE id = $2
		`, *params.TargetName, targetID)
		if err != nil {
			return nil, fmt.Errorf("update target name: %w", err)
		}
	}

	// Recalculate target photo_count
	_, err = tx.Exec(ctx, `
		UPDATE persons SET photo_count = (
			SELECT COUNT(DISTINCT pf.photo_id)
			FROM photo_faces pf
			JOIN faces f ON f.id = pf.face_id
			WHERE f.person_id = $1 AND pf.hidden = FALSE
		), updated_at = NOW()
		WHERE id = $1
	`, targetID)
	if err != nil {
		return nil, fmt.Errorf("update target photo count: %w", err)
	}

	// Delete source persons (cascades to faces table, but faces already moved)
	_, err = tx.Exec(ctx, `DELETE FROM persons WHERE id = ANY($1)`, sourceIDs)
	if err != nil {
		return nil, fmt.Errorf("delete source persons: %w", err)
	}

	return result, tx.Commit(ctx)
}

// selectMergeTarget selects the best target for merge.
// Priority: 1) named person, 2) most photos.
func (s *Storage) selectMergeTarget(persons map[string]*Person) string {
	var namedPerson *Person
	var maxPhotosPerson *Person

	for _, p := range persons {
		if p.NameSource == "manual" {
			if namedPerson == nil || p.PhotoCount > namedPerson.PhotoCount {
				namedPerson = p
			}
		}
		if maxPhotosPerson == nil || p.PhotoCount > maxPhotosPerson.PhotoCount {
			maxPhotosPerson = p
		}
	}

	if namedPerson != nil {
		return namedPerson.ID
	}
	return maxPhotosPerson.ID
}

// =============================================================================
// Person Photos Operations
// =============================================================================

// GetPersonPhotos returns photos for a person with cursor pagination.
func (s *Storage) GetPersonPhotos(ctx context.Context, params PersonPhotosParams) ([]PhotoListItem, *PhotoCursor, error) {
	if params.Limit <= 0 || params.Limit > 500 {
		params.Limit = 100
	}

	args := []interface{}{params.PersonID, params.HiddenOnly}
	argNum := 3

	cursorCond := ""
	if params.Cursor != nil {
		if params.Cursor.TakenAt != nil {
			cursorCond = fmt.Sprintf(" AND (ph.taken_at < $%d OR (ph.taken_at = $%d AND ph.id < $%d))", argNum, argNum, argNum+1)
			args = append(args, *params.Cursor.TakenAt, params.Cursor.ID)
			argNum += 2
		} else {
			cursorCond = fmt.Sprintf(" AND ph.id < $%d", argNum)
			args = append(args, params.Cursor.ID)
			argNum++
		}
	}

	args = append(args, params.Limit+1)

	query := fmt.Sprintf(`
		SELECT DISTINCT ON (ph.taken_at, ph.id)
			ph.id, ph.type, ph.blurhash, ph.small_width, ph.small_height,
			ph.taken_at, ph.is_favorite, ph.duration_sec
		FROM photos ph
		JOIN photo_faces pf ON pf.photo_id = ph.id
		JOIN faces f ON f.id = pf.face_id
		WHERE f.person_id = $1
			AND pf.hidden = $2
			AND ph.status = 'ready'
			%s
		ORDER BY ph.taken_at DESC NULLS LAST, ph.id DESC
		LIMIT $%d
	`, cursorCond, argNum)

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("query person photos: %w", err)
	}
	defer rows.Close()

	photos, err := s.scanPhotoListItems(rows)
	if err != nil {
		return nil, nil, err
	}

	var nextCursor *PhotoCursor
	if len(photos) > params.Limit {
		photos = photos[:params.Limit]
		last := photos[len(photos)-1]
		nextCursor = &PhotoCursor{
			TakenAt: last.TakenAt,
			ID:      last.ID,
		}
	}

	return photos, nextCursor, nil
}

// scanPhotoListItems scans rows into PhotoListItem slice.
func (s *Storage) scanPhotoListItems(rows interface{ Next() bool; Scan(...interface{}) error }) ([]PhotoListItem, error) {
	var photos []PhotoListItem

	for rows.Next() {
		var p PhotoListItem
		var smallWidth, smallHeight sql.NullInt32
		var takenAt sql.NullTime
		var blurhash sql.NullString
		var duration sql.NullInt32

		if err := rows.Scan(&p.ID, &p.Type, &blurhash, &smallWidth, &smallHeight, &takenAt, &p.IsFavorite, &duration); err != nil {
			return nil, fmt.Errorf("scan photo: %w", err)
		}

		if blurhash.Valid {
			p.Blurhash = &blurhash.String
		}
		if smallWidth.Valid {
			p.Width = int(smallWidth.Int32)
		}
		if smallHeight.Valid {
			p.Height = int(smallHeight.Int32)
		}
		if takenAt.Valid {
			p.TakenAt = &takenAt.Time
		}
		if duration.Valid {
			d := int(duration.Int32)
			p.Duration = &d
		}

		photos = append(photos, p)
	}

	return photos, nil
}

// UpdatePersonPhotosParams contains parameters for hiding/unhiding photos.
type UpdatePersonPhotosParams struct {
	PersonID string
	Hide     []string // Photo IDs to hide
	Unhide   []string // Photo IDs to unhide
}

// UpdatePersonPhotos hides or unhides photos for a person.
func (s *Storage) UpdatePersonPhotos(ctx context.Context, params UpdatePersonPhotosParams) (int, error) {
	updated := 0

	// Hide photos
	if len(params.Hide) > 0 {
		res, err := s.db.Exec(ctx, `
			UPDATE photo_faces pf
			SET hidden = TRUE
			FROM faces f
			WHERE pf.face_id = f.id
				AND f.person_id = $1
				AND pf.photo_id = ANY($2)
				AND pf.hidden = FALSE
		`, params.PersonID, params.Hide)
		if err != nil {
			return 0, fmt.Errorf("hide photos: %w", err)
		}
		updated += int(res.RowsAffected())
	}

	// Unhide photos
	if len(params.Unhide) > 0 {
		res, err := s.db.Exec(ctx, `
			UPDATE photo_faces pf
			SET hidden = FALSE
			FROM faces f
			WHERE pf.face_id = f.id
				AND f.person_id = $1
				AND pf.photo_id = ANY($2)
				AND pf.hidden = TRUE
		`, params.PersonID, params.Unhide)
		if err != nil {
			return 0, fmt.Errorf("unhide photos: %w", err)
		}
		updated += int(res.RowsAffected())
	}

	// Recalculate person photo_count
	_, err := s.db.Exec(ctx, `
		UPDATE persons SET photo_count = (
			SELECT COUNT(DISTINCT pf.photo_id)
			FROM photo_faces pf
			JOIN faces f ON f.id = pf.face_id
			WHERE f.person_id = $1 AND pf.hidden = FALSE
		), updated_at = NOW()
		WHERE id = $1
	`, params.PersonID)
	if err != nil {
		return 0, fmt.Errorf("update photo count: %w", err)
	}

	return updated, nil
}

// =============================================================================
// People Groups Operations
// =============================================================================

// ListPeopleGroups returns people groups ordered by photo_count descending.
func (s *Storage) ListPeopleGroups(ctx context.Context, params PeopleGroupListParams) ([]PeopleGroupWithNames, int, error) {
	if params.Limit <= 0 || params.Limit > 100 {
		params.Limit = 15
	}
	if params.Offset < 0 {
		params.Offset = 0
	}

	// Get total count
	var total int
	err := s.db.QueryRow(ctx, "SELECT COUNT(*) FROM people_groups").Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count groups: %w", err)
	}

	// Get groups
	query := `
		SELECT person_ids, photo_count
		FROM people_groups
		ORDER BY photo_count DESC
		LIMIT $1 OFFSET $2
	`

	rows, err := s.db.Query(ctx, query, params.Limit, params.Offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query groups: %w", err)
	}
	defer rows.Close()

	var groups []PeopleGroupWithNames
	for rows.Next() {
		var g PeopleGroupWithNames
		var personIDs []string

		if err := rows.Scan(&personIDs, &g.PhotoCount); err != nil {
			return nil, 0, fmt.Errorf("scan group: %w", err)
		}

		g.PersonIDs = personIDs
		groups = append(groups, g)
	}

	// Fetch names for all person IDs
	if len(groups) > 0 {
		allPersonIDs := make(map[string]bool)
		for _, g := range groups {
			for _, id := range g.PersonIDs {
				allPersonIDs[id] = true
			}
		}

		ids := make([]string, 0, len(allPersonIDs))
		for id := range allPersonIDs {
			ids = append(ids, id)
		}

		nameMap, err := s.getPersonNames(ctx, ids)
		if err != nil {
			return nil, 0, err
		}

		for i := range groups {
			groups[i].Names = make([]string, len(groups[i].PersonIDs))
			for j, id := range groups[i].PersonIDs {
				if name, ok := nameMap[id]; ok {
					groups[i].Names[j] = name
				}
			}
		}
	}

	return groups, total, nil
}

// getPersonNames fetches names for person IDs.
func (s *Storage) getPersonNames(ctx context.Context, ids []string) (map[string]string, error) {
	if len(ids) == 0 {
		return map[string]string{}, nil
	}

	query := `SELECT id, name FROM persons WHERE id = ANY($1)`
	rows, err := s.db.Query(ctx, query, ids)
	if err != nil {
		return nil, fmt.Errorf("query person names: %w", err)
	}
	defer rows.Close()

	names := make(map[string]string)
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("scan name: %w", err)
		}
		names[id] = name
	}

	return names, nil
}

// GetGroupPhotos returns photos for a people group with cursor pagination.
func (s *Storage) GetGroupPhotos(ctx context.Context, params GroupPhotosParams) ([]PhotoListItem, *PhotoCursor, error) {
	if len(params.PersonIDs) < 2 {
		return nil, nil, fmt.Errorf("at least 2 person IDs required")
	}
	if params.Limit <= 0 || params.Limit > 500 {
		params.Limit = 100
	}

	// Sort person IDs for consistent comparison
	sortedIDs := make([]string, len(params.PersonIDs))
	copy(sortedIDs, params.PersonIDs)
	sort.Strings(sortedIDs)

	args := []interface{}{sortedIDs, len(sortedIDs)}
	argNum := 3

	cursorCond := ""
	if params.Cursor != nil {
		if params.Cursor.TakenAt != nil {
			cursorCond = fmt.Sprintf(" AND (ph.taken_at < $%d OR (ph.taken_at = $%d AND ph.id < $%d))", argNum, argNum, argNum+1)
			args = append(args, *params.Cursor.TakenAt, params.Cursor.ID)
			argNum += 2
		} else {
			cursorCond = fmt.Sprintf(" AND ph.id < $%d", argNum)
			args = append(args, params.Cursor.ID)
			argNum++
		}
	}

	// Handle hidden filter
	hiddenCond := ""
	if params.HiddenOnly {
		hiddenCond = fmt.Sprintf(" AND EXISTS (SELECT 1 FROM hidden_group_photos hgp WHERE hgp.person_ids = $%d AND hgp.photo_id = ph.id)", argNum)
		args = append(args, sortedIDs)
		argNum++
	} else {
		hiddenCond = fmt.Sprintf(" AND NOT EXISTS (SELECT 1 FROM hidden_group_photos hgp WHERE hgp.person_ids = $%d AND hgp.photo_id = ph.id)", argNum)
		args = append(args, sortedIDs)
		argNum++
	}

	args = append(args, params.Limit+1)

	// Query photos that contain ALL specified persons
	query := fmt.Sprintf(`
		SELECT ph.id, ph.type, ph.blurhash, ph.small_width, ph.small_height,
			ph.taken_at, ph.is_favorite, ph.duration_sec
		FROM photos ph
		WHERE ph.ai_person_ids @> $1
			AND array_length(ph.ai_person_ids, 1) >= $2
			AND ph.status = 'ready'
			%s
			%s
		ORDER BY ph.taken_at DESC NULLS LAST, ph.id DESC
		LIMIT $%d
	`, cursorCond, hiddenCond, argNum)

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("query group photos: %w", err)
	}
	defer rows.Close()

	photos, err := s.scanPhotoListItems(rows)
	if err != nil {
		return nil, nil, err
	}

	var nextCursor *PhotoCursor
	if len(photos) > params.Limit {
		photos = photos[:params.Limit]
		last := photos[len(photos)-1]
		nextCursor = &PhotoCursor{
			TakenAt: last.TakenAt,
			ID:      last.ID,
		}
	}

	return photos, nextCursor, nil
}

// UpdateGroupPhotosParams contains parameters for hiding/unhiding group photos.
type UpdateGroupPhotosParams struct {
	PersonIDs []string
	Hide      []string // Photo IDs to hide
	Unhide    []string // Photo IDs to unhide
}

// UpdateGroupPhotos hides or unhides photos for a people group.
func (s *Storage) UpdateGroupPhotos(ctx context.Context, params UpdateGroupPhotosParams) (int, error) {
	if len(params.PersonIDs) < 2 {
		return 0, fmt.Errorf("at least 2 person IDs required")
	}

	// Sort person IDs for consistent storage
	sortedIDs := make([]string, len(params.PersonIDs))
	copy(sortedIDs, params.PersonIDs)
	sort.Strings(sortedIDs)

	updated := 0

	// Hide photos
	for _, photoID := range params.Hide {
		res, err := s.db.Exec(ctx, `
			INSERT INTO hidden_group_photos (person_ids, photo_id, hidden_at)
			VALUES ($1, $2, NOW())
			ON CONFLICT (person_ids, photo_id) DO NOTHING
		`, sortedIDs, photoID)
		if err != nil {
			return 0, fmt.Errorf("hide group photo: %w", err)
		}
		updated += int(res.RowsAffected())
	}

	// Unhide photos
	if len(params.Unhide) > 0 {
		res, err := s.db.Exec(ctx, `
			DELETE FROM hidden_group_photos
			WHERE person_ids = $1 AND photo_id = ANY($2)
		`, sortedIDs, params.Unhide)
		if err != nil {
			return 0, fmt.Errorf("unhide group photos: %w", err)
		}
		updated += int(res.RowsAffected())
	}

	return updated, nil
}

// RefreshPeopleGroups refreshes the people_groups materialized view.
func (s *Storage) RefreshPeopleGroups(ctx context.Context) error {
	_, err := s.db.Exec(ctx, "REFRESH MATERIALIZED VIEW CONCURRENTLY people_groups")
	if err != nil {
		// Try non-concurrent refresh if concurrent fails (first time or no unique index)
		_, err = s.db.Exec(ctx, "REFRESH MATERIALIZED VIEW people_groups")
	}
	return err
}

// =============================================================================
// Helpers
// =============================================================================

// generatePersonID generates a unique person ID.
func generatePersonID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return "person_" + hex.EncodeToString(b)
}

// generateFaceID generates a unique face ID.
func generateFaceID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return "face_" + hex.EncodeToString(b)
}
