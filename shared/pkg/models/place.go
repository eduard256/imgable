package models

import (
	"database/sql"
	"time"
)

// NameSource indicates how a place name was determined.
type NameSource string

const (
	NameSourceAuto   NameSource = "auto"   // From Nominatim reverse geocoding
	NameSourceManual NameSource = "manual" // User renamed
)

// Place represents a geographic location for grouping photos.
// Maps to the 'places' table in PostgreSQL.
type Place struct {
	ID string `json:"id" db:"id"` // UUID or hash from coordinates

	// Name
	Name       string     `json:"name" db:"name"`
	NameSource NameSource `json:"name_source" db:"name_source"`

	// Address (from Nominatim)
	Country sql.NullString `json:"country,omitempty" db:"country"`
	City    sql.NullString `json:"city,omitempty" db:"city"`
	Address sql.NullString `json:"address,omitempty" db:"address"`

	// Center coordinates
	GPSLat  float64 `json:"gps_lat" db:"gps_lat"`
	GPSLon  float64 `json:"gps_lon" db:"gps_lon"`
	RadiusM int     `json:"radius_m" db:"radius_m"`

	// Statistics
	PhotoCount int `json:"photo_count" db:"photo_count"`

	// Timestamps
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// PlaceInsert represents data for inserting a new place.
type PlaceInsert struct {
	ID         string
	Name       string
	NameSource string
	Country    *string
	City       *string
	Address    *string
	GPSLat     float64
	GPSLon     float64
	RadiusM    int
}

// PlaceAPI represents place data for API responses.
type PlaceAPI struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	NameSource string `json:"name_source"`
	Country    string `json:"country,omitempty"`
	City       string `json:"city,omitempty"`
	Address    string `json:"address,omitempty"`
	GPSLat     float64 `json:"gps_lat"`
	GPSLon     float64 `json:"gps_lon"`
	RadiusM    int     `json:"radius_m"`
	PhotoCount int     `json:"photo_count"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// ToAPI converts a Place to PlaceAPI for JSON responses.
func (p *Place) ToAPI() PlaceAPI {
	api := PlaceAPI{
		ID:         p.ID,
		Name:       p.Name,
		NameSource: string(p.NameSource),
		GPSLat:     p.GPSLat,
		GPSLon:     p.GPSLon,
		RadiusM:    p.RadiusM,
		PhotoCount: p.PhotoCount,
		CreatedAt:  p.CreatedAt,
		UpdatedAt:  p.UpdatedAt,
	}

	if p.Country.Valid {
		api.Country = p.Country.String
	}
	if p.City.Valid {
		api.City = p.City.String
	}
	if p.Address.Valid {
		api.Address = p.Address.String
	}

	return api
}

// NominatimResponse represents the response from Nominatim reverse geocoding API.
type NominatimResponse struct {
	PlaceID     int               `json:"place_id"`
	License     string            `json:"licence"`
	OSMType     string            `json:"osm_type"`
	OSMID       int               `json:"osm_id"`
	Lat         string            `json:"lat"`
	Lon         string            `json:"lon"`
	DisplayName string            `json:"display_name"`
	Address     NominatimAddress  `json:"address"`
	BoundingBox []string          `json:"boundingbox"`
}

// NominatimAddress represents address details from Nominatim.
type NominatimAddress struct {
	HouseNumber   string `json:"house_number"`
	Road          string `json:"road"`
	Neighbourhood string `json:"neighbourhood"`
	Suburb        string `json:"suburb"`
	Borough       string `json:"borough"`
	City          string `json:"city"`
	Town          string `json:"town"`
	Village       string `json:"village"`
	County        string `json:"county"`
	State         string `json:"state"`
	StateDistrict string `json:"state_district"`
	Postcode      string `json:"postcode"`
	Country       string `json:"country"`
	CountryCode   string `json:"country_code"`
}

// GetCity returns the most specific city-level location.
func (a *NominatimAddress) GetCity() string {
	if a.City != "" {
		return a.City
	}
	if a.Town != "" {
		return a.Town
	}
	if a.Village != "" {
		return a.Village
	}
	return ""
}

// GetLocality returns a human-readable locality name.
func (a *NominatimAddress) GetLocality() string {
	// Try suburb/neighbourhood first for more specific location
	if a.Suburb != "" {
		return a.Suburb
	}
	if a.Neighbourhood != "" {
		return a.Neighbourhood
	}
	// Fall back to city-level
	return a.GetCity()
}
