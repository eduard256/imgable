// Package metrics provides Prometheus metrics for the scanner service.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Metrics holds all Prometheus metrics for the scanner.
type Metrics struct {
	// Files discovered by scanner (total)
	FilesDiscovered prometheus.Counter

	// Files successfully queued for processing
	FilesQueued prometheus.Counter

	// Files skipped (duplicates, unsupported formats)
	FilesSkipped *prometheus.CounterVec

	// Scan duration histogram
	ScanDuration prometheus.Histogram

	// Number of directories being watched
	WatchedDirs prometheus.Gauge

	// fsnotify events received
	FSNotifyEvents *prometheus.CounterVec

	// Polling events
	PollScans prometheus.Counter

	// Queue enqueue errors
	QueueErrors prometheus.Counter

	// Scanner status (1 = running, 0 = stopped)
	ScannerStatus prometheus.Gauge
}

// New creates and registers all scanner metrics.
func New() *Metrics {
	return &Metrics{
		FilesDiscovered: promauto.NewCounter(prometheus.CounterOpts{
			Name: "scanner_files_discovered_total",
			Help: "Total number of media files discovered by scanner",
		}),

		FilesQueued: promauto.NewCounter(prometheus.CounterOpts{
			Name: "scanner_files_queued_total",
			Help: "Total number of files successfully queued for processing",
		}),

		FilesSkipped: promauto.NewCounterVec(prometheus.CounterOpts{
			Name: "scanner_files_skipped_total",
			Help: "Total number of files skipped",
		}, []string{"reason"}), // reason: duplicate, unsupported, unstable

		ScanDuration: promauto.NewHistogram(prometheus.HistogramOpts{
			Name:    "scanner_scan_duration_seconds",
			Help:    "Time taken for directory scans",
			Buckets: []float64{0.1, 0.5, 1, 2, 5, 10, 30, 60, 120},
		}),

		WatchedDirs: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "scanner_watched_dirs",
			Help: "Number of directories currently being watched",
		}),

		FSNotifyEvents: promauto.NewCounterVec(prometheus.CounterOpts{
			Name: "scanner_fsnotify_events_total",
			Help: "Total fsnotify events received",
		}, []string{"type"}), // type: create, write, remove, rename, chmod

		PollScans: promauto.NewCounter(prometheus.CounterOpts{
			Name: "scanner_poll_scans_total",
			Help: "Total number of polling scans performed",
		}),

		QueueErrors: promauto.NewCounter(prometheus.CounterOpts{
			Name: "scanner_queue_errors_total",
			Help: "Total number of errors when enqueuing tasks",
		}),

		ScannerStatus: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "scanner_status",
			Help: "Scanner status (1 = running, 0 = stopped)",
		}),
	}
}

// IncFilesDiscovered increments the files discovered counter.
func (m *Metrics) IncFilesDiscovered() {
	m.FilesDiscovered.Inc()
}

// IncFilesQueued increments the files queued counter.
func (m *Metrics) IncFilesQueued() {
	m.FilesQueued.Inc()
}

// IncFilesSkipped increments the files skipped counter with a reason.
func (m *Metrics) IncFilesSkipped(reason string) {
	m.FilesSkipped.WithLabelValues(reason).Inc()
}

// ObserveScanDuration records a scan duration.
func (m *Metrics) ObserveScanDuration(seconds float64) {
	m.ScanDuration.Observe(seconds)
}

// SetWatchedDirs sets the number of watched directories.
func (m *Metrics) SetWatchedDirs(count int) {
	m.WatchedDirs.Set(float64(count))
}

// IncFSNotifyEvent increments the fsnotify events counter.
func (m *Metrics) IncFSNotifyEvent(eventType string) {
	m.FSNotifyEvents.WithLabelValues(eventType).Inc()
}

// IncPollScans increments the poll scans counter.
func (m *Metrics) IncPollScans() {
	m.PollScans.Inc()
}

// IncQueueErrors increments the queue errors counter.
func (m *Metrics) IncQueueErrors() {
	m.QueueErrors.Inc()
}

// SetScannerRunning sets the scanner status to running.
func (m *Metrics) SetScannerRunning() {
	m.ScannerStatus.Set(1)
}

// SetScannerStopped sets the scanner status to stopped.
func (m *Metrics) SetScannerStopped() {
	m.ScannerStatus.Set(0)
}
