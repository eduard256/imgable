// Package response provides HTTP response helpers for JSON APIs.
package response

import (
	"encoding/json"
	"net/http"
)

// JSON writes a JSON response with the given status code.
// It sets the Content-Type header to application/json.
func JSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if data != nil {
		json.NewEncoder(w).Encode(data)
	}
}

// Error writes a JSON error response.
// Format: {"error": "message"}
func Error(w http.ResponseWriter, status int, message string) {
	JSON(w, status, map[string]string{"error": message})
}

// OK writes a JSON success response with status 200.
func OK(w http.ResponseWriter, data interface{}) {
	JSON(w, http.StatusOK, data)
}

// Created writes a JSON response with status 201.
func Created(w http.ResponseWriter, data interface{}) {
	JSON(w, http.StatusCreated, data)
}

// NoContent writes an empty response with status 204.
func NoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}

// BadRequest writes a 400 error response.
func BadRequest(w http.ResponseWriter, message string) {
	Error(w, http.StatusBadRequest, message)
}

// Unauthorized writes a 401 error response.
func Unauthorized(w http.ResponseWriter, message string) {
	Error(w, http.StatusUnauthorized, message)
}

// Forbidden writes a 403 error response.
func Forbidden(w http.ResponseWriter, message string) {
	Error(w, http.StatusForbidden, message)
}

// NotFound writes a 404 error response.
func NotFound(w http.ResponseWriter, message string) {
	Error(w, http.StatusNotFound, message)
}

// Gone writes a 410 error response (for expired shares).
func Gone(w http.ResponseWriter, message string) {
	Error(w, http.StatusGone, message)
}

// TooManyRequests writes a 429 error response.
func TooManyRequests(w http.ResponseWriter, message string) {
	Error(w, http.StatusTooManyRequests, message)
}

// InternalError writes a 500 error response.
// It returns a generic message to the client.
func InternalError(w http.ResponseWriter) {
	Error(w, http.StatusInternalServerError, "internal server error")
}

// StatusResponse is a common response for simple operations.
type StatusResponse struct {
	Status string `json:"status"`
}

// OKStatus writes {"status": "ok"} with status 200.
func OKStatus(w http.ResponseWriter) {
	OK(w, StatusResponse{Status: "ok"})
}
