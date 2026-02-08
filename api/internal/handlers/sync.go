// Package handlers provides sync proxy HTTP handlers.
// These handlers proxy requests to the scanner and processor services.
package handlers

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/imgable/api/internal/config"
)

// SyncHandler handles sync-related endpoints by proxying to backend services.
type SyncHandler struct {
	config         *config.Config
	logger         *slog.Logger
	scannerProxy   *httputil.ReverseProxy
	processorProxy *httputil.ReverseProxy
	placesProxy    *httputil.ReverseProxy
	aiProxy        *httputil.ReverseProxy
}

// NewSyncHandler creates a new SyncHandler.
func NewSyncHandler(cfg *config.Config, logger *slog.Logger) *SyncHandler {
	h := &SyncHandler{
		config: cfg,
		logger: logger,
	}

	// Create scanner proxy
	scannerURL, err := url.Parse(cfg.ScannerURL)
	if err != nil {
		logger.Error("invalid scanner URL", slog.Any("error", err))
	} else {
		h.scannerProxy = httputil.NewSingleHostReverseProxy(scannerURL)
		h.scannerProxy.ErrorHandler = h.proxyErrorHandler
	}

	// Create processor proxy
	processorURL, err := url.Parse(cfg.ProcessorURL)
	if err != nil {
		logger.Error("invalid processor URL", slog.Any("error", err))
	} else {
		h.processorProxy = httputil.NewSingleHostReverseProxy(processorURL)
		h.processorProxy.ErrorHandler = h.proxyErrorHandler
	}

	// Create places proxy
	placesURL, err := url.Parse(cfg.PlacesURL)
	if err != nil {
		logger.Error("invalid places URL", slog.Any("error", err))
	} else {
		h.placesProxy = httputil.NewSingleHostReverseProxy(placesURL)
		h.placesProxy.ErrorHandler = h.proxyErrorHandler
	}

	// Create AI proxy
	aiURL, err := url.Parse(cfg.AIURL)
	if err != nil {
		logger.Error("invalid AI URL", slog.Any("error", err))
	} else {
		h.aiProxy = httputil.NewSingleHostReverseProxy(aiURL)
		h.aiProxy.ErrorHandler = h.proxyErrorHandler
	}

	return h
}

// ProxyScanner proxies requests to the scanner service.
// Strips /api/v1/sync/scanner prefix from the path.
func (h *SyncHandler) ProxyScanner(w http.ResponseWriter, r *http.Request) {
	if h.scannerProxy == nil {
		http.Error(w, `{"error": "scanner not configured"}`, http.StatusServiceUnavailable)
		return
	}

	// Strip prefix from path
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api/v1/sync/scanner")
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}

	h.scannerProxy.ServeHTTP(w, r)
}

// ProxyProcessor proxies requests to the processor service.
// Strips /api/v1/sync/processor prefix from the path.
func (h *SyncHandler) ProxyProcessor(w http.ResponseWriter, r *http.Request) {
	if h.processorProxy == nil {
		http.Error(w, `{"error": "processor not configured"}`, http.StatusServiceUnavailable)
		return
	}

	// Strip prefix from path
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api/v1/sync/processor")
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}

	h.processorProxy.ServeHTTP(w, r)
}

// ProxyPlaces proxies requests to the places service.
// Strips /api/v1/sync/places prefix from the path.
func (h *SyncHandler) ProxyPlaces(w http.ResponseWriter, r *http.Request) {
	if h.placesProxy == nil {
		http.Error(w, `{"error": "places not configured"}`, http.StatusServiceUnavailable)
		return
	}

	// Strip prefix from path
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api/v1/sync/places")
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}

	h.placesProxy.ServeHTTP(w, r)
}

// ProxyAI proxies requests to the AI service.
// Strips /api/v1/sync/ai prefix from the path.
func (h *SyncHandler) ProxyAI(w http.ResponseWriter, r *http.Request) {
	if h.aiProxy == nil {
		http.Error(w, `{"error": "ai not configured"}`, http.StatusServiceUnavailable)
		return
	}

	// Strip prefix from path
	r.URL.Path = strings.TrimPrefix(r.URL.Path, "/api/v1/sync/ai")
	if r.URL.Path == "" {
		r.URL.Path = "/"
	}

	h.aiProxy.ServeHTTP(w, r)
}

// proxyErrorHandler handles proxy errors.
func (h *SyncHandler) proxyErrorHandler(w http.ResponseWriter, r *http.Request, err error) {
	h.logger.Error("proxy error",
		slog.Any("error", err),
		slog.String("path", r.URL.Path),
	)
	http.Error(w, `{"error": "service unavailable"}`, http.StatusServiceUnavailable)
}
