package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"renovacad/services/api/internal/model"
	"renovacad/services/api/internal/proposal"
)

const maxRequestBytes = 256 * 1024

type Server struct {
	ProposalService *proposal.Service
	APIToken        string
	Version         string
}

func NewRouter(s *Server) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	// Do not log Authorization headers; clean logger.
	r.Use(middleware.Logger)

	r.Get("/health", s.handleHealth)

	// /api is protected when token configured; health stays open.
	r.Route("/api", func(r chi.Router) {
		if s.APIToken != "" {
			r.Use(s.authMiddleware)
		}
		r.Post("/ai/propose-edit", s.handlePropose)
		// Versioned alias for future.
		r.Post("/v1/ai/propose-edit", s.handlePropose)
	})
	// Backward alias without /api prefix for tooling minimalism? Not needed.
	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"service": "renovacad-api",
		"version": s.Version,
	})
}

func (s *Server) handlePropose(w http.ResponseWriter, r *http.Request) {
	// Bounded size and timeout.
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	// Context timeout for handler (15s) — provider has its own 12s.
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	r = r.WithContext(ctx)

	var req model.ProposeRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, 400, "invalid_request", errorMessageForDecode(err))
		return
	}
	// Ensure single JSON object.
	if dec.More() {
		writeError(w, 400, "invalid_request", "request body must contain a single JSON object")
		return
	}

	resp, svcErr := s.ProposalService.Propose(ctx, req)
	if svcErr != nil {
		writeError(w, svcErr.HTTPStatus, svcErr.Code, svcErr.Message)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := ""
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimPrefix(auth, "Bearer ")
		}
		if token == "" {
			token = r.Header.Get("X-RenovaCAD-Token")
		}
		if token == "" {
			token = r.Header.Get("X-API-Token")
		}
		if token != s.APIToken {
			writeError(w, http.StatusUnauthorized, "unauthorized", "invalid or missing API token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(model.ErrorEnvelope{
		Error: model.ErrorBody{Code: code, Message: message},
	})
}

func errorMessageForDecode(err error) string {
	msg := err.Error()
	if strings.Contains(msg, "MaxBytes") || strings.Contains(msg, "request body too large") {
		return "request body too large (max 256 KiB)"
	}
	if strings.Contains(msg, "unknown field") {
		return "unknown field in request: " + msg
	}
	if strings.Contains(msg, "invalid character") || strings.Contains(msg, "unexpected EOF") {
		return "malformed JSON"
	}
	// Avoid leaking internal details.
	return "invalid request body"
}
