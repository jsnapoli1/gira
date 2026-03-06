package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Config struct {
	GiteaURL    string `json:"gitea_url"`
	GiteaAPIKey string `json:"gitea_api_key"`
	Port        int    `json:"port"`
}

func Load() (*Config, error) {
	// Try environment variables first
	giteaURL := os.Getenv("GITEA_URL")
	giteaAPIKey := os.Getenv("GITEA_API_KEY")
	
	port := 9002
	if p := os.Getenv("PORT"); p != "" {
		fmt.Sscanf(p, "%d", &port)
	}

	cfg := &Config{
		GiteaURL:    giteaURL,
		GiteaAPIKey: giteaAPIKey,
		Port:        port,
	}

	// Try loading from config file if env vars not set
	if cfg.GiteaURL == "" || cfg.GiteaAPIKey == "" {
		if err := cfg.LoadFromFile(); err == nil {
			// Config file loaded successfully
			if port != 9002 {
				cfg.Port = port // Env var overrides file
			}
		}
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
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "zira", "config.json")
}
