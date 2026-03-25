package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad_Defaults(t *testing.T) {
	// Clear any environment variables
	os.Unsetenv("PORT")
	os.Unsetenv("GITEA_URL")
	os.Unsetenv("GITEA_API_KEY")
	os.Unsetenv("GITEA_INSECURE_TLS")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.Port != 9002 {
		t.Errorf("expected default port 9002, got %d", cfg.Port)
	}

	if cfg.GiteaURL != "" {
		t.Errorf("expected empty GiteaURL, got %q", cfg.GiteaURL)
	}
}

func TestLoad_FromEnv(t *testing.T) {
	os.Setenv("PORT", "8080")
	os.Setenv("GITEA_URL", "https://gitea.example.com")
	os.Setenv("GITEA_API_KEY", "test-api-key")
	defer func() {
		os.Unsetenv("PORT")
		os.Unsetenv("GITEA_URL")
		os.Unsetenv("GITEA_API_KEY")
	}()

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.Port != 8080 {
		t.Errorf("expected port 8080, got %d", cfg.Port)
	}

	if cfg.GiteaURL != "https://gitea.example.com" {
		t.Errorf("expected GiteaURL 'https://gitea.example.com', got %q", cfg.GiteaURL)
	}

	if cfg.GiteaAPIKey != "test-api-key" {
		t.Errorf("expected GiteaAPIKey 'test-api-key', got %q", cfg.GiteaAPIKey)
	}
}

func TestIsConfigured(t *testing.T) {
	tests := []struct {
		name     string
		config   Config
		expected bool
	}{
		{
			name:     "empty config",
			config:   Config{},
			expected: false,
		},
		{
			name:     "only URL set",
			config:   Config{GiteaURL: "https://gitea.example.com"},
			expected: false,
		},
		{
			name:     "only API key set",
			config:   Config{GiteaAPIKey: "key"},
			expected: false,
		},
		{
			name:     "both URL and API key set",
			config:   Config{GiteaURL: "https://gitea.example.com", GiteaAPIKey: "key"},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.config.IsConfigured()
			if result != tt.expected {
				t.Errorf("IsConfigured() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestSaveAndLoad(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")
	os.Setenv("DB_PATH", dbPath)
	defer os.Unsetenv("DB_PATH")

	cfg := &Config{
		GiteaURL:    "https://gitea.test.com",
		GiteaAPIKey: "test-key",
		Port:        8080,
	}

	if err := cfg.SaveToFile(); err != nil {
		t.Fatalf("SaveToFile() error: %v", err)
	}

	// Load the config back
	loadedCfg := &Config{}
	if err := loadedCfg.LoadFromFile(); err != nil {
		t.Fatalf("LoadFromFile() error: %v", err)
	}

	if loadedCfg.GiteaURL != cfg.GiteaURL {
		t.Errorf("expected GiteaURL %q, got %q", cfg.GiteaURL, loadedCfg.GiteaURL)
	}

	if loadedCfg.GiteaAPIKey != cfg.GiteaAPIKey {
		t.Errorf("expected GiteaAPIKey %q, got %q", cfg.GiteaAPIKey, loadedCfg.GiteaAPIKey)
	}

	if loadedCfg.Port != cfg.Port {
		t.Errorf("expected Port %d, got %d", cfg.Port, loadedCfg.Port)
	}
}

func TestConfigPath(t *testing.T) {
	// Test with DB_PATH set
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")
	os.Setenv("DB_PATH", dbPath)
	defer os.Unsetenv("DB_PATH")

	cfg := &Config{}
	path := cfg.configPath()

	expected := filepath.Join(tmpDir, "config.json")
	if path != expected {
		t.Errorf("expected config path %q, got %q", expected, path)
	}
}

func TestLoad_WithGiteaInsecureTLS(t *testing.T) {
	os.Setenv("GITEA_INSECURE_TLS", "true")
	os.Setenv("GITEA_URL", "https://gitea.example.com")
	os.Setenv("GITEA_API_KEY", "test-key")
	defer func() {
		os.Unsetenv("GITEA_INSECURE_TLS")
		os.Unsetenv("GITEA_URL")
		os.Unsetenv("GITEA_API_KEY")
	}()

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if !cfg.GiteaInsecureTLS {
		t.Error("expected GiteaInsecureTLS to be true")
	}
}

func TestLoad_WithGiteaInsecureTLS_False(t *testing.T) {
	os.Setenv("GITEA_INSECURE_TLS", "false")
	defer os.Unsetenv("GITEA_INSECURE_TLS")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.GiteaInsecureTLS {
		t.Error("expected GiteaInsecureTLS to be false")
	}
}

func TestConfigPath_NoDB_PATH(t *testing.T) {
	// Ensure DB_PATH is not set
	os.Unsetenv("DB_PATH")

	cfg := &Config{}
	path := cfg.configPath()

	// Should return a path ending with .config/gira/config.json
	if !filepath.IsAbs(path) {
		t.Errorf("expected absolute path, got %q", path)
	}
	if filepath.Base(path) != "config.json" {
		t.Errorf("expected path to end with config.json, got %q", path)
	}
}

func TestSaveToFile_CreateDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	// Use a nested directory that doesn't exist
	dbPath := filepath.Join(tmpDir, "nested", "dir", "test.db")
	os.Setenv("DB_PATH", dbPath)
	defer os.Unsetenv("DB_PATH")

	cfg := &Config{
		GiteaURL:    "https://test.com",
		GiteaAPIKey: "key",
		Port:        8080,
	}

	err := cfg.SaveToFile()
	if err != nil {
		t.Fatalf("SaveToFile() should create directories, got error: %v", err)
	}

	// Verify file was created
	loadedCfg := &Config{}
	if err := loadedCfg.LoadFromFile(); err != nil {
		t.Fatalf("LoadFromFile() error: %v", err)
	}

	if loadedCfg.GiteaURL != cfg.GiteaURL {
		t.Errorf("expected GiteaURL %q, got %q", cfg.GiteaURL, loadedCfg.GiteaURL)
	}
}
