package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"renovacad/services/api/internal/analyze"
	"renovacad/services/api/internal/layout"
	"renovacad/services/api/internal/model"
	"renovacad/services/api/internal/proposal"
)

const maxRequestBytes = 256 * 1024
const maxAnalyzeBytes = 8 * 1024 * 1024

type Server struct {
	ProposalService *proposal.Service
	AnalyzeService  *analyze.Service
	LayoutService   *layout.Service
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
		r.Post("/ai/analyze-photo", s.handleAnalyzePhoto)
		r.Post("/v1/ai/analyze-photo", s.handleAnalyzePhoto)
		r.Post("/ai/propose-layout", s.handleProposeLayout)
		r.Post("/v1/ai/propose-layout", s.handleProposeLayout)
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

func (s *Server) handleAnalyzePhoto(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxAnalyzeBytes)
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	if s.AnalyzeService == nil {
		writeError(w, 503, "service_unavailable", "photo analysis is not configured")
		return
	}
	var req model.AnalyzePhotoRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, 400, "invalid_request", errorMessageForDecode(err))
		return
	}
	if dec.More() {
		writeError(w, 400, "invalid_request", "request body must contain a single JSON object")
		return
	}
	resp, svcErr := s.AnalyzeService.Analyze(ctx, req)
	if svcErr != nil {
		writeError(w, svcErr.HTTPStatus, svcErr.Code, svcErr.Message)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleProposeLayout(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxAnalyzeBytes)
	ctx, cancel := context.WithTimeout(r.Context(), 22*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	if s.LayoutService == nil {
		writeError(w, 503, "service_unavailable", "layout proposal is not configured")
		return
	}
	var req model.LayoutDraftRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, 400, "invalid_request", errorMessageForDecode(err))
		return
	}
	if dec.More() {
		writeError(w, 400, "invalid_request", "request body must contain a single JSON object")
		return
	}
	resp, svcErr := s.LayoutService.ProposeDraft(ctx, req)
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
