// Package logger provides a structured logging wrapper around zerolog.
// It supports both human-readable text format and JSON format for production use.
// The logger is configured via environment variables LOG_LEVEL and LOG_FORMAT.
package logger

import (
	"io"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

// Logger wraps zerolog.Logger with additional context methods.
type Logger struct {
	zl zerolog.Logger
}

// Config holds logger configuration options.
type Config struct {
	// Level is the minimum log level (debug, info, warn, error)
	Level string
	// Format is the output format (text or json)
	Format string
	// Service is the service name to include in all log entries
	Service string
}

// DefaultConfig returns configuration with sensible defaults.
func DefaultConfig() Config {
	return Config{
		Level:   getEnv("LOG_LEVEL", "info"),
		Format:  getEnv("LOG_FORMAT", "text"),
		Service: getEnv("SERVICE_NAME", "imgable"),
	}
}

// New creates a new Logger with the given configuration.
func New(cfg Config) *Logger {
	level := parseLevel(cfg.Level)
	zerolog.SetGlobalLevel(level)

	var output io.Writer = os.Stdout

	if strings.ToLower(cfg.Format) == "text" {
		output = zerolog.ConsoleWriter{
			Out:        os.Stdout,
			TimeFormat: time.RFC3339,
			NoColor:    false,
		}
	}

	zl := zerolog.New(output).
		With().
		Timestamp().
		Str("service", cfg.Service).
		Logger()

	return &Logger{zl: zl}
}

// NewDefault creates a logger with default configuration from environment.
func NewDefault(service string) *Logger {
	cfg := DefaultConfig()
	cfg.Service = service
	return New(cfg)
}

// With returns a new Logger with additional context fields.
func (l *Logger) With() zerolog.Context {
	return l.zl.With()
}

// WithField returns a new Logger with an additional field.
func (l *Logger) WithField(key string, value interface{}) *Logger {
	return &Logger{zl: l.zl.With().Interface(key, value).Logger()}
}

// WithFields returns a new Logger with additional fields.
func (l *Logger) WithFields(fields map[string]interface{}) *Logger {
	ctx := l.zl.With()
	for k, v := range fields {
		ctx = ctx.Interface(k, v)
	}
	return &Logger{zl: ctx.Logger()}
}

// WithError returns a new Logger with an error field.
func (l *Logger) WithError(err error) *Logger {
	return &Logger{zl: l.zl.With().Err(err).Logger()}
}

// Debug logs a debug message.
func (l *Logger) Debug(msg string) {
	l.zl.Debug().Msg(msg)
}

// Debugf logs a formatted debug message.
func (l *Logger) Debugf(format string, args ...interface{}) {
	l.zl.Debug().Msgf(format, args...)
}

// Info logs an info message.
func (l *Logger) Info(msg string) {
	l.zl.Info().Msg(msg)
}

// Infof logs a formatted info message.
func (l *Logger) Infof(format string, args ...interface{}) {
	l.zl.Info().Msgf(format, args...)
}

// Warn logs a warning message.
func (l *Logger) Warn(msg string) {
	l.zl.Warn().Msg(msg)
}

// Warnf logs a formatted warning message.
func (l *Logger) Warnf(format string, args ...interface{}) {
	l.zl.Warn().Msgf(format, args...)
}

// Error logs an error message.
func (l *Logger) Error(msg string) {
	l.zl.Error().Msg(msg)
}

// Errorf logs a formatted error message.
func (l *Logger) Errorf(format string, args ...interface{}) {
	l.zl.Error().Msgf(format, args...)
}

// Fatal logs a fatal message and exits the program.
func (l *Logger) Fatal(msg string) {
	l.zl.Fatal().Msg(msg)
}

// Fatalf logs a formatted fatal message and exits the program.
func (l *Logger) Fatalf(format string, args ...interface{}) {
	l.zl.Fatal().Msgf(format, args...)
}

// Event returns a new log event at the given level for chaining.
func (l *Logger) Event(level string) *zerolog.Event {
	switch strings.ToLower(level) {
	case "debug":
		return l.zl.Debug()
	case "info":
		return l.zl.Info()
	case "warn", "warning":
		return l.zl.Warn()
	case "error":
		return l.zl.Error()
	default:
		return l.zl.Info()
	}
}

// Zerolog returns the underlying zerolog.Logger for advanced usage.
func (l *Logger) Zerolog() zerolog.Logger {
	return l.zl
}

// parseLevel converts a string log level to zerolog.Level.
func parseLevel(level string) zerolog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return zerolog.DebugLevel
	case "info":
		return zerolog.InfoLevel
	case "warn", "warning":
		return zerolog.WarnLevel
	case "error":
		return zerolog.ErrorLevel
	case "fatal":
		return zerolog.FatalLevel
	case "panic":
		return zerolog.PanicLevel
	case "disabled", "off":
		return zerolog.Disabled
	default:
		return zerolog.InfoLevel
	}
}

// getEnv returns environment variable value or default if not set.
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
