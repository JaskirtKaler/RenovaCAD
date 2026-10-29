package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"renovacad/services/api/internal/analyze"
	"renovacad/services/api/internal/baseten"
	"renovacad/services/api/internal/config"
	"renovacad/services/api/internal/httpapi"
	"renovacad/services/api/internal/layout"
	"renovacad/services/api/internal/proposal"
)

func main() {
	cfg := config.Load()

	// Basic loopback check unless token auth is used: warn if binding non-loopback without token.
	if !isLoopbackAddr(cfg.Addr) && cfg.APIToken == "" {
		log.Printf("WARN: binding to %s without RENOVACAD_API_TOKEN; set token for non-loopback access", cfg.Addr)
	}

	provider := baseten.New(cfg.BasetenBaseURL, cfg.BasetenModel, cfg.BasetenAPIKey, cfg.ProviderTimeout)
	svc := &proposal.Service{Provider: provider}
	analyzeSvc := &analyze.Service{Provider: provider}
	layoutSvc := &layout.Service{Provider: provider}
	handler := httpapi.NewRouter(&httpapi.Server{
		ProposalService: svc,
		AnalyzeService:  analyzeSvc,
		LayoutService:   layoutSvc,
		APIToken:        cfg.APIToken,
		Version:         "0.1.0",
	})

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
		BaseContext: func(_ net.Listener) context.Context {
			return context.Background()
		},
	}

	log.Printf("RenovaCAD API listening on %s (model %s @ %s)", cfg.Addr, cfg.BasetenModel, cfg.BasetenBaseURL)
	if cfg.BasetenAPIKey == "" {
		log.Printf("WARN: BASETEN_API_KEY not set; provider calls will fail until configured")
	}
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("server error: %v", err)
		os.Exit(1)
	}
}

func isLoopbackAddr(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	if ip != nil {
		return ip.IsLoopback()
	}
	// Hostname like localhost
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
