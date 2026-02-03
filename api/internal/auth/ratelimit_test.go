package auth

import (
	"testing"
	"time"
)

func TestRateLimiter_Allow(t *testing.T) {
	rl := NewRateLimiter(3, time.Minute)

	ip := "192.168.1.1"

	// First 3 attempts should be allowed
	for i := 0; i < 3; i++ {
		if !rl.Allow(ip) {
			t.Errorf("Attempt %d should be allowed", i+1)
		}
	}

	// 4th attempt should be blocked
	if rl.Allow(ip) {
		t.Error("4th attempt should be blocked")
	}

	// Different IP should still be allowed
	if !rl.Allow("192.168.1.2") {
		t.Error("Different IP should be allowed")
	}
}

func TestRateLimiter_WindowExpiry(t *testing.T) {
	rl := NewRateLimiter(2, 50*time.Millisecond)

	ip := "192.168.1.1"

	// Use up the limit
	rl.Allow(ip)
	rl.Allow(ip)

	// Should be blocked
	if rl.Allow(ip) {
		t.Error("Should be blocked after limit")
	}

	// Wait for window to expire
	time.Sleep(60 * time.Millisecond)

	// Should be allowed again
	if !rl.Allow(ip) {
		t.Error("Should be allowed after window expiry")
	}
}

func TestRateLimiter_SlidingWindow(t *testing.T) {
	rl := NewRateLimiter(3, 100*time.Millisecond)

	ip := "192.168.1.1"

	// First attempt
	rl.Allow(ip)
	time.Sleep(40 * time.Millisecond)

	// Second attempt
	rl.Allow(ip)
	time.Sleep(40 * time.Millisecond)

	// Third attempt
	rl.Allow(ip)

	// Fourth should be blocked (all 3 within window)
	if rl.Allow(ip) {
		t.Error("4th attempt should be blocked")
	}

	// Wait for first attempt to expire
	time.Sleep(30 * time.Millisecond)

	// Now should be allowed (first attempt outside window)
	if !rl.Allow(ip) {
		t.Error("Should be allowed after partial window expiry")
	}
}

func TestRateLimiter_ConcurrentAccess(t *testing.T) {
	rl := NewRateLimiter(100, time.Minute)

	done := make(chan bool)

	// Run concurrent requests
	for i := 0; i < 10; i++ {
		go func(n int) {
			ip := "192.168.1.1"
			for j := 0; j < 10; j++ {
				rl.Allow(ip)
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Should not panic and should have correct count
	// (100 attempts, limit is 100, so all should be counted)
}
