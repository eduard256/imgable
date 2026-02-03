package worker

import (
	"errors"
	"testing"
)

func TestHashToLockID(t *testing.T) {
	// Same hash should produce same lock ID
	hash1 := "abc123def456"
	lockID1 := hashToLockID(hash1)
	lockID2 := hashToLockID(hash1)

	if lockID1 != lockID2 {
		t.Errorf("Same hash should produce same lock ID: %d != %d", lockID1, lockID2)
	}

	// Different hashes should produce different lock IDs (with high probability)
	hash2 := "xyz789xyz789"
	lockID3 := hashToLockID(hash2)

	if lockID1 == lockID3 {
		t.Error("Different hashes should produce different lock IDs")
	}

	// Lock ID should be non-zero for non-empty hash
	if lockID1 == 0 {
		t.Error("Lock ID should not be zero")
	}
}

func TestIsDuplicateKeyError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{
			name:     "nil error",
			err:      nil,
			expected: false,
		},
		{
			name:     "generic error",
			err:      errors.New("some random error"),
			expected: false,
		},
		{
			name:     "duplicate key error with code",
			err:      errors.New("ERROR: duplicate key value violates unique constraint (SQLSTATE 23505)"),
			expected: true,
		},
		{
			name:     "duplicate key error without code",
			err:      errors.New("duplicate key value violates unique constraint \"photos_pkey\""),
			expected: true,
		},
		{
			name:     "unique constraint error",
			err:      errors.New("unique constraint violation on photos.id"),
			expected: true,
		},
		{
			name:     "connection error",
			err:      errors.New("connection refused"),
			expected: false,
		},
		{
			name:     "timeout error",
			err:      errors.New("context deadline exceeded"),
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isDuplicateKeyError(tt.err)
			if result != tt.expected {
				t.Errorf("isDuplicateKeyError(%v) = %v, want %v", tt.err, result, tt.expected)
			}
		})
	}
}

func TestContains(t *testing.T) {
	tests := []struct {
		s        string
		substr   string
		expected bool
	}{
		{"hello world", "world", true},
		{"hello world", "hello", true},
		{"hello world", "xyz", false},
		{"", "", true},
		{"abc", "", true},
		{"", "abc", false},
		{"abc", "abc", true},
		{"abc", "abcd", false},
		{"duplicate key", "duplicate", true},
		{"23505", "23505", true},
	}

	for _, tt := range tests {
		t.Run(tt.s+"_"+tt.substr, func(t *testing.T) {
			result := contains(tt.s, tt.substr)
			if result != tt.expected {
				t.Errorf("contains(%q, %q) = %v, want %v", tt.s, tt.substr, result, tt.expected)
			}
		})
	}
}

func TestHashToLockIDDeterministic(t *testing.T) {
	// Test that the same input always produces the same output
	testCases := []string{
		"abc123def456",
		"xyz789xyz789",
		"000000000000",
		"ffffffffffff",
		"a1b2c3d4e5f6",
	}

	for _, hash := range testCases {
		t.Run(hash, func(t *testing.T) {
			// Call multiple times
			results := make([]int64, 10)
			for i := 0; i < 10; i++ {
				results[i] = hashToLockID(hash)
			}

			// All results should be the same
			for i := 1; i < len(results); i++ {
				if results[i] != results[0] {
					t.Errorf("hashToLockID not deterministic: %d != %d", results[i], results[0])
				}
			}
		})
	}
}

func TestHashToLockIDDistribution(t *testing.T) {
	// Test that different hashes produce different lock IDs
	// This isn't guaranteed, but collisions should be rare
	hashes := []string{
		"abc123def456",
		"abc123def457",
		"bbc123def456",
		"abc124def456",
		"123456789012",
		"000000000001",
		"000000000002",
	}

	lockIDs := make(map[int64]string)
	for _, hash := range hashes {
		lockID := hashToLockID(hash)
		if existing, ok := lockIDs[lockID]; ok {
			t.Errorf("Hash collision between %q and %q: both produce lock ID %d", existing, hash, lockID)
		}
		lockIDs[lockID] = hash
	}
}
