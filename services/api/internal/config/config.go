package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Config holds non-secret and secret settings. Secrets are never logged.
// Defaults are documented in services/api/.env.example.
type Config struct {
	Addr            string
	BasetenBaseURL  string
	BasetenModel    string
	BasetenAPIKey   string
	APIToken        string
	ProviderTimeout time.Duration
}

func Load() Config {
	// Optionally load services/api/.env when vars are not already exported.
	// Go programs do not read .env automatically; support the documented copy-to-.env workflow.
	loadDotEnvIfPresent()

	addr := envOr("RENOVACAD_API_ADDR", "127.0.0.1:8787")
	baseURL := envOr("BASETEN_BASE_URL", "https://inference.baseten.co/v1")
	model := envOr("BASETEN_MODEL", "meta-models/muse-spark-open")
	key := os.Getenv("BASETEN_API_KEY")
	token := os.Getenv("RENOVACAD_API_TOKEN")
	timeout := 12 * time.Second
	if v := os.Getenv("RENOVACAD_PROVIDER_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			timeout = d
		}
	}
	return Config{
		Addr:            addr,
		BasetenBaseURL:  baseURL,
		BasetenModel:    model,
		BasetenAPIKey:   key,
		APIToken:        token,
		ProviderTimeout: timeout,
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func loadDotEnvIfPresent() {
	for _, candidate := range dotEnvCandidates() {
		if err := loadDotEnvFile(candidate); err == nil {
			return
		}
	}
}

func dotEnvCandidates() []string {
	var out []string
	if wd, err := os.Getwd(); err == nil {
		out = append(out, filepath.Join(wd, ".env"))
	}
	if exe, err := os.Executable(); err == nil {
		out = append(out, filepath.Join(filepath.Dir(exe), ".env"))
		// When running `go run ./cmd/server`, executable is a temp dir; also try project-relative services/api/.env discovery.
		// Walk up a few parents to find services/api/.env.
		dir := filepath.Dir(exe)
		for i := 0; i < 6; i++ {
			out = append(out, filepath.Join(dir, "services", "api", ".env"))
			out = append(out, filepath.Join(dir, ".env"))
			dir = filepath.Dir(dir)
		}
	}
	// Explicit project-relative when cwd is repo root or services/api.
	out = append(out, "services/api/.env", ".env")
	return out
}

func loadDotEnvFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Strip optional `export ` prefix.
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		eq := strings.Index(line, "=")
		if eq <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.TrimSpace(line[eq+1:])
		// Strip surrounding quotes.
		if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
			val = val[1 : len(val)-1]
		}
		if key == "" {
			continue
		}
		// Do not override already-exported vars (explicit env wins).
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		_ = os.Setenv(key, val)
	}
	return scanner.Err()
}
