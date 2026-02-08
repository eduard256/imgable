// Package handlers provides people-related HTTP handlers.
// Handles persons, faces, and people groups for AI face recognition features.
package handlers

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/imgable/api/internal/auth"
	"github.com/imgable/api/internal/config"
	"github.com/imgable/api/internal/response"
	"github.com/imgable/api/internal/storage"
)

// PeopleHandler handles people-related endpoints.
type PeopleHandler struct {
	storage *storage.Storage
	config  *config.Config
	logger  *slog.Logger
}

// NewPeopleHandler creates a new PeopleHandler.
func NewPeopleHandler(store *storage.Storage, cfg *config.Config, logger *slog.Logger) *PeopleHandler {
	return &PeopleHandler{
		storage: store,
		config:  cfg,
		logger:  logger,
	}
}

// =============================================================================
// Response Types
// =============================================================================

// PersonItem represents a person in list response.
type PersonItem struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	NameSource string   `json:"name_source"`
	PhotoCount int      `json:"photo_count"`
	FaceURL    *string  `json:"face_url,omitempty"`
	FaceBox    *FaceBox `json:"face_box,omitempty"`
}

// FaceBox represents face bounding box for cropping.
type FaceBox struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// PersonsListResponse represents response for listing persons.
type PersonsListResponse struct {
	People  []PersonItem `json:"people"`
	Total   int          `json:"total"`
	HasMore bool         `json:"has_more"`
}

// PersonDetailResponse represents detailed person info.
type PersonDetailResponse struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	NameSource string   `json:"name_source"`
	PhotoCount int      `json:"photo_count"`
	FaceURL    *string  `json:"face_url,omitempty"`
	FaceBox    *FaceBox `json:"face_box,omitempty"`
	FacesCount int      `json:"faces_count"`
	CreatedAt  int64    `json:"created_at"`
	UpdatedAt  int64    `json:"updated_at"`
}

// FaceItem represents a face in list response.
type FaceItem struct {
	ID         string  `json:"id"`
	PhotoCount int     `json:"photo_count"`
	PreviewURL string  `json:"preview_url"`
	PreviewBox FaceBox `json:"preview_box"`
}

// FacesListResponse represents response for listing person faces.
type FacesListResponse struct {
	Faces []FaceItem `json:"faces"`
}

// PeopleGroupItem represents a people group in list response.
type PeopleGroupItem struct {
	PersonIDs  []string  `json:"person_ids"`
	Names      []string  `json:"names"`
	PhotoCount int       `json:"photo_count"`
	FaceURLs   []*string `json:"face_urls"`
}

// PeopleGroupsListResponse represents response for listing people groups.
type PeopleGroupsListResponse struct {
	Groups  []PeopleGroupItem `json:"groups"`
	Total   int               `json:"total"`
	HasMore bool              `json:"has_more"`
}

// PhotosListResponse represents response for listing photos with pagination.
type PhotosListResponse struct {
	Photos     []PhotoItem `json:"photos"`
	NextCursor string      `json:"next_cursor,omitempty"`
	HasMore    bool        `json:"has_more"`
}

// =============================================================================
// List Persons
// =============================================================================

// List handles GET /api/v1/people.
// Returns paginated list of persons ordered by photo_count.
//
// Query parameters:
//   - limit: Max persons to return (default 15, max 100)
//   - offset: Pagination offset (default 0)
func (h *PeopleHandler) List(w http.ResponseWriter, r *http.Request) {
	params := storage.PersonListParams{
		Limit:  parseIntParam(r, "limit", 15),
		Offset: parseIntParam(r, "offset", 0),
	}

	persons, total, err := h.storage.ListPersons(r.Context(), params)
	if err != nil {
		h.logger.Error("failed to list persons", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	token := auth.GetToken(r.Context())

	items := make([]PersonItem, len(persons))
	for i, p := range persons {
		items[i] = PersonItem{
			ID:         p.ID,
			Name:       p.Name,
			NameSource: p.NameSource,
			PhotoCount: p.PhotoCount,
		}
		if p.CoverPhotoID != nil {
			url := h.photoURL(*p.CoverPhotoID, "s", token)
			items[i].FaceURL = &url
		}
		if p.CoverBox != nil {
			items[i].FaceBox = &FaceBox{
				X: p.CoverBox.X,
				Y: p.CoverBox.Y,
				W: p.CoverBox.W,
				H: p.CoverBox.H,
			}
		}
	}

	response.OK(w, PersonsListResponse{
		People:  items,
		Total:   total,
		HasMore: params.Offset+len(items) < total,
	})
}

// =============================================================================
// Get Person
// =============================================================================

// Get handles GET /api/v1/people/{id}.
// Returns detailed person information.
func (h *PeopleHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	person, err := h.storage.GetPerson(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to get person", slog.Any("error", err), slog.String("id", id))
		response.InternalError(w)
		return
	}
	if person == nil {
		response.NotFound(w, "person not found")
		return
	}

	// Get faces count
	faces, err := h.storage.ListPersonFaces(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to get person faces", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	token := auth.GetToken(r.Context())

	resp := PersonDetailResponse{
		ID:         person.ID,
		Name:       person.Name,
		NameSource: person.NameSource,
		PhotoCount: person.PhotoCount,
		FacesCount: len(faces),
		CreatedAt:  person.CreatedAt.Unix(),
		UpdatedAt:  person.UpdatedAt.Unix(),
	}

	if person.CoverPhotoID != nil {
		url := h.photoURL(*person.CoverPhotoID, "s", token)
		resp.FaceURL = &url
	}
	if person.CoverBox != nil {
		resp.FaceBox = &FaceBox{
			X: person.CoverBox.X,
			Y: person.CoverBox.Y,
			W: person.CoverBox.W,
			H: person.CoverBox.H,
		}
	}

	response.OK(w, resp)
}

// =============================================================================
// Update Person
// =============================================================================

// UpdatePersonRequest represents person update request.
type UpdatePersonRequest struct {
	Name        *string `json:"name,omitempty"`
	CoverFaceID *string `json:"cover_face_id,omitempty"`
}

// Update handles PATCH /api/v1/people/{id}.
// Updates person name and/or cover face.
func (h *PeopleHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req UpdatePersonRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "invalid request body")
		return
	}

	err := h.storage.UpdatePerson(r.Context(), id, storage.UpdatePersonParams{
		Name:        req.Name,
		CoverFaceID: req.CoverFaceID,
	})
	if err != nil {
		if err.Error() == "person not found" {
			response.NotFound(w, "person not found")
			return
		}
		if strings.Contains(err.Error(), "cover face does not belong") {
			response.BadRequest(w, err.Error())
			return
		}
		h.logger.Error("failed to update person", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OKStatus(w)
}

// =============================================================================
// Delete Person
// =============================================================================

// Delete handles DELETE /api/v1/people/{id}.
// Deletes a person and all associated faces.
func (h *PeopleHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	err := h.storage.DeletePerson(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to delete person", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OKStatus(w)
}

// =============================================================================
// Person Photos
// =============================================================================

// GetPhotos handles GET /api/v1/people/{id}/photos.
// Returns paginated list of photos for a person.
//
// Query parameters:
//   - limit: Max photos to return (default 100, max 500)
//   - cursor: Pagination cursor
func (h *PeopleHandler) GetPhotos(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Check person exists
	person, err := h.storage.GetPerson(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to get person", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if person == nil {
		response.NotFound(w, "person not found")
		return
	}

	params := storage.PersonPhotosParams{
		PersonID:   id,
		Limit:      parseIntParam(r, "limit", 100),
		HiddenOnly: false,
	}

	if cursorStr := r.URL.Query().Get("cursor"); cursorStr != "" {
		params.Cursor = storage.DecodeCursor(cursorStr)
	}

	photos, nextCursor, err := h.storage.GetPersonPhotos(r.Context(), params)
	if err != nil {
		h.logger.Error("failed to get person photos", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	token := auth.GetToken(r.Context())
	items := h.buildPhotoItems(photos, token)

	resp := PhotosListResponse{
		Photos:  items,
		HasMore: nextCursor != nil,
	}
	if nextCursor != nil {
		resp.NextCursor = storage.EncodeCursor(nextCursor)
	}

	response.OK(w, resp)
}

// GetHiddenPhotos handles GET /api/v1/people/{id}/photos/hidden.
// Returns hidden photos for a person.
func (h *PeopleHandler) GetHiddenPhotos(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Check person exists
	person, err := h.storage.GetPerson(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to get person", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if person == nil {
		response.NotFound(w, "person not found")
		return
	}

	params := storage.PersonPhotosParams{
		PersonID:   id,
		Limit:      parseIntParam(r, "limit", 100),
		HiddenOnly: true,
	}

	if cursorStr := r.URL.Query().Get("cursor"); cursorStr != "" {
		params.Cursor = storage.DecodeCursor(cursorStr)
	}

	photos, nextCursor, err := h.storage.GetPersonPhotos(r.Context(), params)
	if err != nil {
		h.logger.Error("failed to get hidden photos", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	token := auth.GetToken(r.Context())
	items := h.buildPhotoItems(photos, token)

	resp := PhotosListResponse{
		Photos:  items,
		HasMore: nextCursor != nil,
	}
	if nextCursor != nil {
		resp.NextCursor = storage.EncodeCursor(nextCursor)
	}

	response.OK(w, resp)
}

// UpdatePhotosRequest represents request to hide/unhide photos.
type UpdatePhotosRequest struct {
	Hide   []string `json:"hide,omitempty"`
	Unhide []string `json:"unhide,omitempty"`
}

// UpdatePhotosResponse represents response after hiding/unhiding photos.
type UpdatePhotosResponse struct {
	Updated int `json:"updated"`
}

// UpdatePhotos handles PATCH /api/v1/people/{id}/photos.
// Hides or unhides photos for a person.
func (h *PeopleHandler) UpdatePhotos(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req UpdatePhotosRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "invalid request body")
		return
	}

	if len(req.Hide) == 0 && len(req.Unhide) == 0 {
		response.BadRequest(w, "hide or unhide is required")
		return
	}

	if len(req.Hide) > 100 || len(req.Unhide) > 100 {
		response.BadRequest(w, "maximum 100 photos per request")
		return
	}

	// Check person exists
	person, err := h.storage.GetPerson(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to get person", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if person == nil {
		response.NotFound(w, "person not found")
		return
	}

	updated, err := h.storage.UpdatePersonPhotos(r.Context(), storage.UpdatePersonPhotosParams{
		PersonID: id,
		Hide:     req.Hide,
		Unhide:   req.Unhide,
	})
	if err != nil {
		h.logger.Error("failed to update photos", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OK(w, UpdatePhotosResponse{Updated: updated})
}

// =============================================================================
// Person Faces
// =============================================================================

// GetFaces handles GET /api/v1/people/{id}/faces.
// Returns list of faces belonging to a person.
func (h *PeopleHandler) GetFaces(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Check person exists
	person, err := h.storage.GetPerson(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to get person", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if person == nil {
		response.NotFound(w, "person not found")
		return
	}

	faces, err := h.storage.ListPersonFaces(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to list faces", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	token := auth.GetToken(r.Context())

	items := make([]FaceItem, len(faces))
	for i, f := range faces {
		items[i] = FaceItem{
			ID:         f.ID,
			PhotoCount: f.PhotoCount,
			PreviewURL: h.photoURL(f.PreviewPhotoID, "s", token),
			PreviewBox: FaceBox{
				X: f.PreviewBox.X,
				Y: f.PreviewBox.Y,
				W: f.PreviewBox.W,
				H: f.PreviewBox.H,
			},
		}
	}

	response.OK(w, FacesListResponse{Faces: items})
}

// DetachFaceResponse represents response after detaching a face.
type DetachFaceResponse struct {
	NewPersonID string `json:"new_person_id"`
}

// DetachFace handles DELETE /api/v1/people/{id}/faces/{faceId}.
// Detaches a face from person and creates a new person for it.
func (h *PeopleHandler) DetachFace(w http.ResponseWriter, r *http.Request) {
	personID := chi.URLParam(r, "id")
	faceID := chi.URLParam(r, "faceId")

	newPersonID, err := h.storage.DetachFace(r.Context(), personID, faceID)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			response.NotFound(w, err.Error())
			return
		}
		if strings.Contains(err.Error(), "cannot detach the only face") {
			response.BadRequest(w, err.Error())
			return
		}
		h.logger.Error("failed to detach face", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OK(w, DetachFaceResponse{NewPersonID: newPersonID})
}

// =============================================================================
// Merge Persons
// =============================================================================

// MergePersonsRequest represents merge request.
type MergePersonsRequest struct {
	SourceIDs  []string `json:"source_ids"`
	TargetID   string   `json:"target_id,omitempty"`
	TargetName *string  `json:"target_name,omitempty"`
}

// MergePersonsResponse represents merge response.
type MergePersonsResponse struct {
	TargetID      string `json:"target_id"`
	MergedCount   int    `json:"merged_count"`
	FacesMoved    int    `json:"faces_moved"`
	PhotosUpdated int    `json:"photos_updated"`
}

// Merge handles POST /api/v1/people/merge.
// Merges multiple persons into one.
func (h *PeopleHandler) Merge(w http.ResponseWriter, r *http.Request) {
	var req MergePersonsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "invalid request body")
		return
	}

	if len(req.SourceIDs) < 2 {
		response.BadRequest(w, "at least 2 source_ids required")
		return
	}

	if len(req.SourceIDs) > 20 {
		response.BadRequest(w, "maximum 20 persons per merge")
		return
	}

	result, err := h.storage.MergePersons(r.Context(), storage.MergePersonsParams{
		SourceIDs:  req.SourceIDs,
		TargetID:   req.TargetID,
		TargetName: req.TargetName,
	})
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			response.NotFound(w, err.Error())
			return
		}
		if strings.Contains(err.Error(), "multiple persons have names") {
			response.Conflict(w, err.Error())
			return
		}
		if strings.Contains(err.Error(), "target_id must be one of source_ids") {
			response.BadRequest(w, err.Error())
			return
		}
		h.logger.Error("failed to merge persons", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OK(w, MergePersonsResponse{
		TargetID:      result.TargetID,
		MergedCount:   result.MergedCount,
		FacesMoved:    result.FacesMoved,
		PhotosUpdated: result.PhotosUpdated,
	})
}

// =============================================================================
// People Groups
// =============================================================================

// ListGroups handles GET /api/v1/people/groups.
// Returns paginated list of people groups ordered by photo_count.
//
// Query parameters:
//   - limit: Max groups to return (default 15, max 100)
//   - offset: Pagination offset (default 0)
func (h *PeopleHandler) ListGroups(w http.ResponseWriter, r *http.Request) {
	params := storage.PeopleGroupListParams{
		Limit:  parseIntParam(r, "limit", 15),
		Offset: parseIntParam(r, "offset", 0),
	}

	groups, total, err := h.storage.ListPeopleGroups(r.Context(), params)
	if err != nil {
		h.logger.Error("failed to list groups", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	token := auth.GetToken(r.Context())

	// Get face URLs for each person in groups
	personCovers := make(map[string]*storage.PersonWithCover)
	for _, g := range groups {
		for _, pid := range g.PersonIDs {
			if _, ok := personCovers[pid]; !ok {
				person, err := h.storage.GetPerson(r.Context(), pid)
				if err == nil && person != nil {
					personCovers[pid] = person
				}
			}
		}
	}

	items := make([]PeopleGroupItem, len(groups))
	for i, g := range groups {
		items[i] = PeopleGroupItem{
			PersonIDs:  g.PersonIDs,
			Names:      g.Names,
			PhotoCount: g.PhotoCount,
			FaceURLs:   make([]*string, len(g.PersonIDs)),
		}

		for j, pid := range g.PersonIDs {
			if person, ok := personCovers[pid]; ok && person.CoverPhotoID != nil {
				url := h.photoURL(*person.CoverPhotoID, "s", token)
				items[i].FaceURLs[j] = &url
			}
		}
	}

	response.OK(w, PeopleGroupsListResponse{
		Groups:  items,
		Total:   total,
		HasMore: params.Offset+len(items) < total,
	})
}

// GetGroupPhotos handles GET /api/v1/people/groups/photos.
// Returns paginated list of photos for a people group.
//
// Query parameters:
//   - ids: Comma-separated person IDs (required)
//   - limit: Max photos to return (default 100, max 500)
//   - cursor: Pagination cursor
func (h *PeopleHandler) GetGroupPhotos(w http.ResponseWriter, r *http.Request) {
	idsStr := r.URL.Query().Get("ids")
	if idsStr == "" {
		response.BadRequest(w, "ids query parameter is required")
		return
	}

	personIDs := strings.Split(idsStr, ",")
	if len(personIDs) < 2 {
		response.BadRequest(w, "at least 2 person IDs required")
		return
	}

	params := storage.GroupPhotosParams{
		PersonIDs:  personIDs,
		Limit:      parseIntParam(r, "limit", 100),
		HiddenOnly: false,
	}

	if cursorStr := r.URL.Query().Get("cursor"); cursorStr != "" {
		params.Cursor = storage.DecodeCursor(cursorStr)
	}

	photos, nextCursor, err := h.storage.GetGroupPhotos(r.Context(), params)
	if err != nil {
		h.logger.Error("failed to get group photos", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	token := auth.GetToken(r.Context())
	items := h.buildPhotoItems(photos, token)

	resp := PhotosListResponse{
		Photos:  items,
		HasMore: nextCursor != nil,
	}
	if nextCursor != nil {
		resp.NextCursor = storage.EncodeCursor(nextCursor)
	}

	response.OK(w, resp)
}

// GetGroupHiddenPhotos handles GET /api/v1/people/groups/photos/hidden.
// Returns hidden photos for a people group.
func (h *PeopleHandler) GetGroupHiddenPhotos(w http.ResponseWriter, r *http.Request) {
	idsStr := r.URL.Query().Get("ids")
	if idsStr == "" {
		response.BadRequest(w, "ids query parameter is required")
		return
	}

	personIDs := strings.Split(idsStr, ",")
	if len(personIDs) < 2 {
		response.BadRequest(w, "at least 2 person IDs required")
		return
	}

	params := storage.GroupPhotosParams{
		PersonIDs:  personIDs,
		Limit:      parseIntParam(r, "limit", 100),
		HiddenOnly: true,
	}

	if cursorStr := r.URL.Query().Get("cursor"); cursorStr != "" {
		params.Cursor = storage.DecodeCursor(cursorStr)
	}

	photos, nextCursor, err := h.storage.GetGroupPhotos(r.Context(), params)
	if err != nil {
		h.logger.Error("failed to get group hidden photos", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	token := auth.GetToken(r.Context())
	items := h.buildPhotoItems(photos, token)

	resp := PhotosListResponse{
		Photos:  items,
		HasMore: nextCursor != nil,
	}
	if nextCursor != nil {
		resp.NextCursor = storage.EncodeCursor(nextCursor)
	}

	response.OK(w, resp)
}

// UpdateGroupPhotosRequest represents request to hide/unhide group photos.
type UpdateGroupPhotosRequest struct {
	PersonIDs []string `json:"person_ids"`
	Hide      []string `json:"hide,omitempty"`
	Unhide    []string `json:"unhide,omitempty"`
}

// UpdateGroupPhotos handles PATCH /api/v1/people/groups/photos.
// Hides or unhides photos for a people group.
func (h *PeopleHandler) UpdateGroupPhotos(w http.ResponseWriter, r *http.Request) {
	var req UpdateGroupPhotosRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "invalid request body")
		return
	}

	if len(req.PersonIDs) < 2 {
		response.BadRequest(w, "at least 2 person_ids required")
		return
	}

	if len(req.Hide) == 0 && len(req.Unhide) == 0 {
		response.BadRequest(w, "hide or unhide is required")
		return
	}

	if len(req.Hide) > 100 || len(req.Unhide) > 100 {
		response.BadRequest(w, "maximum 100 photos per request")
		return
	}

	updated, err := h.storage.UpdateGroupPhotos(r.Context(), storage.UpdateGroupPhotosParams{
		PersonIDs: req.PersonIDs,
		Hide:      req.Hide,
		Unhide:    req.Unhide,
	})
	if err != nil {
		h.logger.Error("failed to update group photos", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OK(w, UpdatePhotosResponse{Updated: updated})
}

// =============================================================================
// Helpers
// =============================================================================

// photoURL generates a URL for a photo preview.
func (h *PeopleHandler) photoURL(id, size, token string) string {
	return fmt.Sprintf("/photos/%s/%s/%s_%s.webp?token=%s",
		id[:2], id[2:4], id, size, token)
}

// buildPhotoItems converts storage photos to handler response items.
func (h *PeopleHandler) buildPhotoItems(photos []storage.PhotoListItem, token string) []PhotoItem {
	items := make([]PhotoItem, len(photos))
	for i, p := range photos {
		items[i] = PhotoItem{
			ID:         p.ID,
			Type:       p.Type,
			Blurhash:   p.Blurhash,
			Small:      h.photoURL(p.ID, "s", token),
			Width:      p.Width,
			Height:     p.Height,
			IsFavorite: p.IsFavorite,
			Duration:   p.Duration,
		}
		if p.TakenAt != nil {
			ts := p.TakenAt.Unix()
			items[i].TakenAt = &ts
		}
	}
	return items
}
