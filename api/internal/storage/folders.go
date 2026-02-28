// Package storage provides folder-related database operations.
// Folders are virtual -- they are derived from photos.original_path values,
// not from the filesystem. This allows browsing photos by their original
// import directory structure.
package storage

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

// Folder represents a virtual folder derived from photo original paths.
type Folder struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	PhotoCount int    `json:"photo_count"`
}

// FolderListing represents the contents of a folder at a specific path.
type FolderListing struct {
	Path             string   `json:"path"`
	Folders          []Folder `json:"folders"`
	PhotoCount       int      `json:"photo_count"`        // Total photos in this folder and all subfolders
	DirectPhotoCount int      `json:"direct_photo_count"` // Photos only in this folder (not in subfolders)
}

// GetFolderListing returns subfolders and direct photo count for the given path.
// Path "/" means the top level. Paths do not have a leading slash
// (except "/" itself for the root).
//
// Files without a directory component (e.g. "web_upload_123.png") are ignored
// and not displayed in the folder tree.
func (s *Storage) GetFolderListing(ctx context.Context, path string) (*FolderListing, error) {
	// Query all distinct original_path values with counts.
	// Filter out paths without a "/" -- those are root-level files we skip.
	rows, err := s.db.Query(ctx, `
		SELECT original_path, COUNT(*) as cnt
		FROM photos
		WHERE status = 'ready'
			AND original_path IS NOT NULL
			AND original_path != ''
			AND original_path LIKE '%/%'
		GROUP BY original_path
	`)
	if err != nil {
		return nil, fmt.Errorf("query folder paths: %w", err)
	}
	defer rows.Close()

	// Normalize the requested path
	path = normalizeFolderPath(path)

	// Collect subfolders and direct photo counts
	subfolders := make(map[string]int) // subfolder name -> total photo count
	directPhotos := 0

	for rows.Next() {
		var originalPath string
		var count int
		if err := rows.Scan(&originalPath, &count); err != nil {
			return nil, fmt.Errorf("scan folder path: %w", err)
		}

		// Parse the path into directory and remaining parts
		dir, _ := splitPathAtLevel(originalPath, path)

		if dir == "" {
			continue
		}

		if dir == "." {
			directPhotos += count
			continue
		}

		subfolders[dir] += count
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate folder paths: %w", err)
	}

	// Build sorted folder list
	folders := make([]Folder, 0, len(subfolders))
	for name, count := range subfolders {
		folderPath := name
		if path != "" {
			folderPath = path + "/" + name
		}
		folders = append(folders, Folder{
			Name:       name,
			Path:       folderPath,
			PhotoCount: count,
		})
	}

	sort.Slice(folders, func(i, j int) bool {
		return folders[i].Name < folders[j].Name
	})

	// Total photo count = direct photos + all subfolder photos
	totalPhotos := directPhotos
	for _, f := range folders {
		totalPhotos += f.PhotoCount
	}

	return &FolderListing{
		Path:             path,
		Folders:          folders,
		PhotoCount:       totalPhotos,
		DirectPhotoCount: directPhotos,
	}, nil
}

// normalizeFolderPath cleans up the path parameter.
// "/" and "" both become "" (root level).
// Trailing slashes are removed.
func normalizeFolderPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "/" || path == "" {
		return ""
	}
	path = strings.TrimPrefix(path, "/")
	path = strings.TrimSuffix(path, "/")
	return path
}

// splitPathAtLevel determines where an original_path falls relative to the
// requested folder path.
//
// Returns:
//   - (".", "") if the file is directly in the requested folder
//   - ("subfolder", "rest/of/path") if the file is inside a subfolder
//   - ("", "") if the file doesn't belong to the requested folder at all
func splitPathAtLevel(originalPath, requestedPath string) (string, string) {
	originalPath = strings.TrimSpace(originalPath)
	if originalPath == "" {
		return "", ""
	}

	// Determine the relative path within the requested folder
	var relativePath string

	if requestedPath == "" {
		relativePath = originalPath
	} else {
		if !strings.HasPrefix(originalPath, requestedPath+"/") {
			return "", ""
		}
		relativePath = originalPath[len(requestedPath)+1:]
	}

	// Find the next path separator
	slashIdx := strings.IndexByte(relativePath, '/')
	if slashIdx == -1 {
		// No more slashes -- file is directly in the requested folder
		return ".", ""
	}

	subfolder := relativePath[:slashIdx]
	remaining := relativePath[slashIdx+1:]

	if subfolder == "" {
		// Leading slash -- recurse on the rest
		return splitPathAtLevel(remaining, "")
	}

	return subfolder, remaining
}
