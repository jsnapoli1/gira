package main

import (
	"log"

	"github.com/jsnapoli/zira/internal/config"
	"github.com/jsnapoli/zira/internal/database"
	"github.com/jsnapoli/zira/internal/server"
)

// version is set at build time via -ldflags
var version = "dev"

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	db, err := database.New()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	srv := server.New(cfg, db, version)

	if err := srv.Start(); err != nil {
		log.Fatal(err)
	}
}
