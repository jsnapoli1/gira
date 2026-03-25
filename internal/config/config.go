package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Config struct {
	GiteaURL         string `json:"gitea_url"`
	GiteaAPIKey      string `json:"gitea_api_key"`
	GiteaInsecureTLS bool   `json:"gitea_insecure_tls"`
	Port             int    `json:"port"`
}

func Load() (*Config, error) {
	port := 9002
	if p := os.Getenv("PORT"); p != "" {
		fmt.Sscanf(p, "%d", &port)
	}

	cfg := &Config{
		Port: port,
	}

	// Try loading from config file first
	if err := cfg.LoadFromFile(); err == nil {
		// Config file loaded successfully
	}

	// Environment variables override config file (only if non-empty)
	if p := os.Getenv("PORT"); p != "" {
		fmt.Sscanf(p, "%d", &cfg.Port)
	}
	if giteaURL := os.Getenv("GITEA_URL"); giteaURL != "" {
		cfg.GiteaURL = giteaURL
	}
	if giteaAPIKey := os.Getenv("GITEA_API_KEY"); giteaAPIKey != "" {
		cfg.GiteaAPIKey = giteaAPIKey
	}
	if os.Getenv("GITEA_INSECURE_TLS") == "true" {
		cfg.GiteaInsecureTLS = true
	}

	return cfg, nil
}

func (c *Config) IsConfigured() bool {
	return c.GiteaURL != "" && c.GiteaAPIKey != ""
}

func (c *Config) LoadFromFile() error {
	configPath := c.configPath()
	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, c)
}

func (c *Config) SaveToFile() error {
	configPath := c.configPath()
	if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(configPath, data, 0600)
}

func (c *Config) configPath() string {
	// If DB_PATH is set (Docker deployment), use the same directory for config
	if dbPath := os.Getenv("DB_PATH"); dbPath != "" {
		return filepath.Join(filepath.Dir(dbPath), "config.json")
	}
	// Default to ~/.config/gira/config.json for local development
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.TempDir()
	}
	return filepath.Join(home, ".config", "gira", "config.json")
}
