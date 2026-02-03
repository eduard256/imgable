// Package metrics provides Prometheus metrics for the processor service.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Metrics holds all Prometheus metrics for the processor.
type Metrics struct {
	// Tasks processed (total)
	TasksProcessed *prometheus.CounterVec

	// Tasks failed
	TasksFailed *prometheus.CounterVec

	// Tasks retried
	TasksRetried prometheus.Counter

	// Processing duration histogram
	ProcessingDuration *prometheus.HistogramVec

	// Queue size
	QueueSize *prometheus.GaugeVec

	// Active workers
	ActiveWorkers prometheus.Gauge

	// Memory usage
	MemoryUsage prometheus.Gauge

	// Files by type (photo/video)
	FilesByType *prometheus.CounterVec

	// Processor status (1 = running, 0 = stopped)
	ProcessorStatus prometheus.Gauge

	// Geocoding requests
	GeocodingRequests *prometheus.CounterVec

	// Failed files count
	FailedFilesCount prometheus.Gauge
}

// New creates and registers all processor metrics.
func New() *Metrics {
	return &Metrics{
		TasksProcessed: promauto.NewCounterVec(prometheus.CounterOpts{
			Name: "processor_tasks_processed_total",
			Help: "Total number of tasks processed",
		}, []string{"status"}), // status: success, failed

		TasksFailed: promauto.NewCounterVec(prometheus.CounterOpts{
			Name: "processor_tasks_failed_total",
			Help: "Total number of failed tasks",
		}, []string{"stage"}), // stage: hash, resize, metadata, database, etc.

		TasksRetried: promauto.NewCounter(prometheus.CounterOpts{
			Name: "processor_tasks_retried_total",
			Help: "Total number of retried tasks",
		}),

		ProcessingDuration: promauto.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "processor_processing_duration_seconds",
			Help:    "Time taken to process files",
			Buckets: []float64{0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300},
		}, []string{"type"}), // type: photo, video

		QueueSize: promauto.NewGaugeVec(prometheus.GaugeOpts{
			Name: "processor_queue_size",
			Help: "Current queue size",
		}, []string{"queue", "status"}), // queue: default, retry; status: pending, active

		ActiveWorkers: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "processor_active_workers",
			Help: "Number of currently active workers",
		}),

		MemoryUsage: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "processor_memory_usage_bytes",
			Help: "Current memory usage in bytes",
		}),

		FilesByType: promauto.NewCounterVec(prometheus.CounterOpts{
			Name: "processor_files_by_type_total",
			Help: "Total files processed by type",
		}, []string{"type"}), // type: photo, video

		ProcessorStatus: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "processor_status",
			Help: "Processor status (1 = running, 0 = stopped)",
		}),

		GeocodingRequests: promauto.NewCounterVec(prometheus.CounterOpts{
			Name: "processor_geocoding_requests_total",
			Help: "Total geocoding requests",
		}, []string{"status"}), // status: success, failed, skipped

		FailedFilesCount: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "processor_failed_files_count",
			Help: "Current number of files in /failed directory",
		}),
	}
}

// IncTasksProcessed increments the tasks processed counter.
func (m *Metrics) IncTasksProcessed(status string) {
	m.TasksProcessed.WithLabelValues(status).Inc()
}

// IncTasksFailed increments the tasks failed counter.
func (m *Metrics) IncTasksFailed(stage string) {
	m.TasksFailed.WithLabelValues(stage).Inc()
}

// IncTasksRetried increments the tasks retried counter.
func (m *Metrics) IncTasksRetried() {
	m.TasksRetried.Inc()
}

// ObserveProcessingDuration records a processing duration.
func (m *Metrics) ObserveProcessingDuration(fileType string, seconds float64) {
	m.ProcessingDuration.WithLabelValues(fileType).Observe(seconds)
}

// SetQueueSize sets the queue size.
func (m *Metrics) SetQueueSize(queue, status string, count int) {
	m.QueueSize.WithLabelValues(queue, status).Set(float64(count))
}

// SetActiveWorkers sets the active workers count.
func (m *Metrics) SetActiveWorkers(count int) {
	m.ActiveWorkers.Set(float64(count))
}

// SetMemoryUsage sets the memory usage.
func (m *Metrics) SetMemoryUsage(bytes int64) {
	m.MemoryUsage.Set(float64(bytes))
}

// IncFilesByType increments the files by type counter.
func (m *Metrics) IncFilesByType(fileType string) {
	m.FilesByType.WithLabelValues(fileType).Inc()
}

// SetProcessorRunning sets the processor status to running.
func (m *Metrics) SetProcessorRunning() {
	m.ProcessorStatus.Set(1)
}

// SetProcessorStopped sets the processor status to stopped.
func (m *Metrics) SetProcessorStopped() {
	m.ProcessorStatus.Set(0)
}

// IncGeocodingRequests increments the geocoding requests counter.
func (m *Metrics) IncGeocodingRequests(status string) {
	m.GeocodingRequests.WithLabelValues(status).Inc()
}

// SetFailedFilesCount sets the failed files count.
func (m *Metrics) SetFailedFilesCount(count int) {
	m.FailedFilesCount.Set(float64(count))
}
