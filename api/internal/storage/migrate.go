// Package storage provides database access layer for the Imgable API.
// This file handles automatic database schema migration on startup
// using golang-migrate with PostgreSQL advisory locks for safe concurrent execution.
package storage

import (
	"errors"
	"fmt"
	"log/slog"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

// RunMigrations applies all pending database migrations from the given directory.
// It uses PostgreSQL advisory locks internally (via golang-migrate) to prevent
// concurrent migration runs when multiple API instances start simultaneously.
// If the database is already up-to-date, this is a no-op.
func RunMigrations(logger *slog.Logger, databaseURL, migrationsPath string) error {
	sourceURL := "file://" + migrationsPath

	m, err := migrate.New(sourceURL, convertToPgxURL(databaseURL))
	if err != nil {
		return fmt.Errorf("failed to create migrate instance: %w", err)
	}
	defer m.Close()

	err = m.Up()
	if errors.Is(err, migrate.ErrNoChange) {
		logger.Info("database schema is up to date")
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to apply migrations: %w", err)
	}

	version, dirty, _ := m.Version()
	logger.Info("database migrations applied",
		slog.Uint64("version", uint64(version)),
		slog.Bool("dirty", dirty),
	)
	return nil
}

// convertToPgxURL converts a postgres:// URL to pgx5:// scheme
// required by golang-migrate's pgx v5 driver.
func convertToPgxURL(dbURL string) string {
	if len(dbURL) > 11 && dbURL[:11] == "postgres://" {
		return "pgx5://" + dbURL[11:]
	}
	if len(dbURL) > 14 && dbURL[:14] == "postgresql://" {
		return "pgx5://" + dbURL[14:]
	}
	return dbURL
}
