package analyze

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"renovacad/services/api/internal/baseten"
	"renovacad/services/api/internal/model"
)

const (
	maxImageBytes = 5 * 1024 * 1024
	validMimeJPEG = "image/jpeg"
	validMimePNG  = "image/png"
	validMimeWEBP = "image/webp"
)

type Service struct {
	Provider baseten.Provider
}

func (s *Service) Analyze(ctx context.Context, req model.AnalyzePhotoRequest) (model.AnalyzePhotoResponse, *ServiceError) {
	if err := validate(req); err != nil {
		return model.AnalyzePhotoResponse{}, err
	}
	mime := req.Image.MimeType
	dataURL := req.Image.DataURL
	prefix := fmt.Sprintf("data:%s;base64,", mime)
	b64 := strings.TrimPrefix(dataURL, prefix)
	// Validate base64 decodable and size
	decodedLen := base64.StdEncoding.DecodedLen(len(b64))
	if decodedLen > maxImageBytes {
		return model.AnalyzePhotoResponse{}, &ServiceError{Code: "invalid_request", Message: "image too large (limit 5 MB)", HTTPStatus: 400}
	}
	// Actually decode to validate
	decoded := make([]byte, decodedLen)
	n, err := base64.StdEncoding.Decode(decoded, []byte(b64))
	if err != nil {
		// Try RawStdEncoding without padding? But our dataURL should be standard.
		// Try with padding stripped case using Raw.
		decoded2, err2 := base64.StdEncoding.DecodeString(b64)
		if err2 != nil {
			return model.AnalyzePhotoResponse{}, &ServiceError{Code: "invalid_request", Message: "image data is not valid base64", HTTPStatus: 400}
		}
		n = len(decoded2)
		if n > maxImageBytes {
			return model.AnalyzePhotoResponse{}, &ServiceError{Code: "invalid_request", Message: "image too large (limit 5 MB)", HTTPStatus: 400}
		}
	}
	if n > maxImageBytes {
		return model.AnalyzePhotoResponse{}, &ServiceError{Code: "invalid_request", Message: "image too large (limit 5 MB)", HTTPStatus: 400}
	}
	// Call provider
	raw, err := s.Provider.AnalyzePhoto(ctx, mime, b64, req.Image.Name)
	if err != nil {
		if isTimeout(err) {
			return model.AnalyzePhotoResponse{}, &ServiceError{Code: "provider_timeout", Message: "AI provider timed out", HTTPStatus: 504}
		}
		if isInvalidProviderResponse(err) {
			return model.AnalyzePhotoResponse{}, &ServiceError{Code: "invalid_provider_response", Message: "AI provider returned unusable output", HTTPStatus: 502}
		}
		return model.AnalyzePhotoResponse{}, &ServiceError{Code: "provider_error", Message: "AI provider error", HTTPStatus: 502}
	}
	// Validate provider output
	desc := strings.TrimSpace(raw.Description)
	if desc == "" {
		return model.AnalyzePhotoResponse{}, &ServiceError{Code: "invalid_provider_response", Message: "provider returned empty description", HTTPStatus: 502}
	}
	if len(desc) > 4000 {
		desc = desc[:4000]
	}
	q := raw.FollowUpQuestions
	if len(q) > 10 {
		q = q[:10]
	}
	cleanQ := []string{}
	for _, s := range q {
		t := strings.TrimSpace(s)
		if t == "" {
			continue
		}
		if len(t) > 300 {
			t = t[:300]
		}
		cleanQ = append(cleanQ, t)
	}
	if len(cleanQ) == 0 {
		cleanQ = []string{"What are the wall dimensions for this kitchen?", "What changes are you considering?"}
	}
	return model.AnalyzePhotoResponse{
		Kind:              "analysis",
		Description:       desc,
		FollowUpQuestions: cleanQ,
	}, nil
}

type ServiceError struct {
	Code       string
	Message    string
	HTTPStatus int
}

func (e *ServiceError) Error() string { return e.Code + ": " + e.Message }

func validate(req model.AnalyzePhotoRequest) *ServiceError {
	if strings.TrimSpace(req.Image.Name) == "" {
		return &ServiceError{Code: "invalid_request", Message: "image name is required", HTTPStatus: 400}
	}
	if len(req.Image.Name) > 200 {
		return &ServiceError{Code: "invalid_request", Message: "image name too long", HTTPStatus: 400}
	}
	if req.Image.MimeType != validMimeJPEG && req.Image.MimeType != validMimePNG && req.Image.MimeType != validMimeWEBP {
		return &ServiceError{Code: "invalid_request", Message: "unsupported image type (use JPG, PNG, or WEBP)", HTTPStatus: 400}
	}
	if !strings.HasPrefix(req.Image.DataURL, fmt.Sprintf("data:%s;base64,", req.Image.MimeType)) {
		return &ServiceError{Code: "invalid_request", Message: "image dataUrl must be data:<mime>;base64,...", HTTPStatus: 400}
	}
	prefix := fmt.Sprintf("data:%s;base64,", req.Image.MimeType)
	b64 := strings.TrimPrefix(req.Image.DataURL, prefix)
	if len(b64) == 0 {
		return &ServiceError{Code: "invalid_request", Message: "image data is empty", HTTPStatus: 400}
	}
	if len(b64) > 7_100_000 {
		return &ServiceError{Code: "invalid_request", Message: "image too large (limit 5 MB)", HTTPStatus: 400}
	}
	if len(b64)%4 == 1 {
		return &ServiceError{Code: "invalid_request", Message: "image data is not valid base64", HTTPStatus: 400}
	}
	// Check base64 chars
	for _, ch := range b64 {
		if !((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '+' || ch == '/' || ch == '=') {
			return &ServiceError{Code: "invalid_request", Message: "image data is not valid base64", HTTPStatus: 400}
		}
	}
	if len(req.Image.DataURL) > 7_100_000 {
		return &ServiceError{Code: "invalid_request", Message: "image too large (limit 5 MB)", HTTPStatus: 400}
	}
	return nil
}

func isTimeout(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "provider timeout") || strings.Contains(msg, "deadline") || strings.Contains(msg, "context deadline")
}

func isInvalidProviderResponse(err error) bool {
	return strings.Contains(err.Error(), "invalid provider response")
}
