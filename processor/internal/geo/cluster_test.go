package geo

import (
	"math"
	"testing"
)

func TestHaversine(t *testing.T) {
	tests := []struct {
		name     string
		lat1     float64
		lon1     float64
		lat2     float64
		lon2     float64
		expected float64
		delta    float64 // Allowed deviation in meters
	}{
		{
			name:     "same point",
			lat1:     55.751244,
			lon1:     37.618423,
			lat2:     55.751244,
			lon2:     37.618423,
			expected: 0,
			delta:    1,
		},
		{
			name:     "moscow to st petersburg",
			lat1:     55.751244,  // Moscow
			lon1:     37.618423,
			lat2:     59.9343,    // St. Petersburg
			lon2:     30.3351,
			expected: 634000,     // ~634 km
			delta:    10000,      // Allow 10km deviation
		},
		{
			name:     "nearby points",
			lat1:     55.751244,
			lon1:     37.618423,
			lat2:     55.752244,  // ~100m north
			lon2:     37.618423,
			expected: 111,        // ~111m per 0.001 degree latitude
			delta:    10,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := Haversine(tt.lat1, tt.lon1, tt.lat2, tt.lon2)

			diff := math.Abs(result - tt.expected)
			if diff > tt.delta {
				t.Errorf("Haversine(%f, %f, %f, %f) = %f, want %f (±%f)",
					tt.lat1, tt.lon1, tt.lat2, tt.lon2, result, tt.expected, tt.delta)
			}
		})
	}
}

func TestGeneratePlaceID(t *testing.T) {
	// Same coordinates should produce same ID
	id1 := generatePlaceID(55.751244, 37.618423)
	id2 := generatePlaceID(55.751244, 37.618423)

	if id1 != id2 {
		t.Errorf("Same coordinates should produce same ID: %q != %q", id1, id2)
	}

	// ID should start with "pl_" prefix
	if len(id1) < 3 || id1[:3] != "pl_" {
		t.Errorf("Place ID should start with 'pl_': %q", id1)
	}

	// ID should have reasonable length
	if len(id1) != 15 { // "pl_" + 12 chars
		t.Errorf("Place ID should be 15 chars: got %d", len(id1))
	}

	// Different coordinates should produce different ID
	id3 := generatePlaceID(40.7128, -74.0060) // New York
	if id1 == id3 {
		t.Error("Different coordinates should produce different IDs")
	}

	// Very close coordinates (within rounding) might produce same ID
	// This is expected behavior for clustering
	id4 := generatePlaceID(55.75124, 37.61842) // Slightly different
	// This might be same or different depending on rounding
	_ = id4 // Just verify it doesn't panic
}

func TestHaversineSymmetry(t *testing.T) {
	// Distance should be symmetric
	lat1, lon1 := 55.751244, 37.618423
	lat2, lon2 := 59.9343, 30.3351

	dist1 := Haversine(lat1, lon1, lat2, lon2)
	dist2 := Haversine(lat2, lon2, lat1, lon1)

	if math.Abs(dist1-dist2) > 0.001 {
		t.Errorf("Haversine should be symmetric: %f != %f", dist1, dist2)
	}
}

func TestHaversineZeroDistance(t *testing.T) {
	// Distance to itself should be (effectively) zero
	lat, lon := 55.751244, 37.618423
	dist := Haversine(lat, lon, lat, lon)

	if dist > 0.001 {
		t.Errorf("Distance to itself should be ~0, got %f", dist)
	}
}
