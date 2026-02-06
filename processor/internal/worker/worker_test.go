package worker

import (
	"testing"
)

func TestHelperFunctions(t *testing.T) {
	// Test strPtr
	t.Run("strPtr", func(t *testing.T) {
		// Empty string returns nil
		if strPtr("") != nil {
			t.Error("strPtr(\"\") should return nil")
		}

		// Non-empty string returns pointer
		result := strPtr("hello")
		if result == nil || *result != "hello" {
			t.Error("strPtr(\"hello\") should return pointer to \"hello\"")
		}
	})

	// Test intPtr
	t.Run("intPtr", func(t *testing.T) {
		// Zero returns nil
		if intPtr(0) != nil {
			t.Error("intPtr(0) should return nil")
		}

		// Non-zero returns pointer
		result := intPtr(42)
		if result == nil || *result != 42 {
			t.Error("intPtr(42) should return pointer to 42")
		}
	})

	// Test float64Ptr
	t.Run("float64Ptr", func(t *testing.T) {
		// Zero returns nil
		if float64Ptr(0) != nil {
			t.Error("float64Ptr(0) should return nil")
		}

		// Non-zero returns pointer
		result := float64Ptr(3.14)
		if result == nil || *result != 3.14 {
			t.Error("float64Ptr(3.14) should return pointer to 3.14")
		}
	})

	// Test boolPtr
	t.Run("boolPtr", func(t *testing.T) {
		// Always returns pointer
		resultTrue := boolPtr(true)
		if resultTrue == nil || *resultTrue != true {
			t.Error("boolPtr(true) should return pointer to true")
		}

		resultFalse := boolPtr(false)
		if resultFalse == nil || *resultFalse != false {
			t.Error("boolPtr(false) should return pointer to false")
		}
	})
}
