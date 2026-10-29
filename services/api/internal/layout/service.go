package layout

import (
	"context"
	"encoding/base64"
	"fmt"
	"math"
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

var validKinds = map[string]bool{
	"base-cabinet": true,
	"wall-cabinet": true,
	"tall-cabinet": true,
	"wall":         true,
	"sink":         true,
}

type Service struct {
	Provider baseten.Provider
}

func (s *Service) ProposeDraft(ctx context.Context, req model.LayoutDraftRequest) (model.LayoutDraftResponse, *ServiceError) {
	if err := validate(req); err != nil {
		return model.LayoutDraftResponse{}, err
	}
	mime := req.Image.MimeType
	b64 := strings.TrimPrefix(req.Image.DataURL, fmt.Sprintf("data:%s;base64,", mime))
	decodedLen := base64.StdEncoding.DecodedLen(len(b64))
	if decodedLen > maxImageBytes {
		return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_request", Message: "image too large (limit 5 MB)", HTTPStatus: 400}
	}
	decoded := make([]byte, decodedLen)
	n, err := base64.StdEncoding.Decode(decoded, []byte(b64))
	if err != nil {
		decoded2, err2 := base64.StdEncoding.DecodeString(b64)
		if err2 != nil {
			return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_request", Message: "image data is not valid base64", HTTPStatus: 400}
		}
		n = len(decoded2)
		if n > maxImageBytes {
			return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_request", Message: "image too large (limit 5 MB)", HTTPStatus: 400}
		}
	}
	if n > maxImageBytes {
		return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_request", Message: "image too large (limit 5 MB)", HTTPStatus: 400}
	}

	raw, err := s.Provider.ProposeLayout(ctx, mime, b64, req.Image.Name)
	if err != nil {
		if isTimeout(err) {
			return model.LayoutDraftResponse{}, &ServiceError{Code: "provider_timeout", Message: "AI provider timed out. Check network and try again.", HTTPStatus: 504}
		}
		if isMissingAPIKey(err) {
			return model.LayoutDraftResponse{}, &ServiceError{Code: "service_unavailable", Message: "AI service is unavailable — not configured. Check BASETEN_API_KEY and restart the Go backend.", HTTPStatus: 503}
		}
		if isUnauthorized(err) {
			return model.LayoutDraftResponse{}, &ServiceError{Code: "unauthorized", Message: "AI provider rejected credentials. Check BASETEN_API_KEY.", HTTPStatus: 401}
		}
		if isModelUnavailable(err) {
			return model.LayoutDraftResponse{}, &ServiceError{Code: "model_unavailable", Message: "AI model is not available for this account. Check BASETEN_MODEL and endpoint access.", HTTPStatus: 403}
		}
		if isModelNotFound(err) {
			return model.LayoutDraftResponse{}, &ServiceError{Code: "model_not_found", Message: "AI model not found. Check BASETEN_MODEL.", HTTPStatus: 404}
		}
		if isRateLimited(err) {
			return model.LayoutDraftResponse{}, &ServiceError{Code: "rate_limited", Message: "AI provider rate limited. Try again shortly.", HTTPStatus: 429}
		}
		if isInvalidProviderResponse(err) {
			return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: "AI provider returned unusable output. Try a clearer photo.", HTTPStatus: 502}
		}
		return model.LayoutDraftResponse{}, &ServiceError{Code: "provider_error", Message: "AI provider error. Try again.", HTTPStatus: 502}
	}

	// Validate raw kind
	kind := strings.TrimSpace(raw.Kind)
	switch kind {
	case "needs_info":
		msg := strings.TrimSpace(raw.Message)
		if msg == "" {
			msg = "Not enough information in the photo to create a layout draft."
		}
		if len(msg) > 2000 {
			msg = msg[:2000]
		}
		qs := cleanQuestions(raw.FollowUpQuestions)
		if len(qs) == 0 {
			qs = []string{"Can you provide a clearer kitchen photo or wall dimensions?"}
		}
		return model.LayoutDraftResponse{
			Kind:              "needs_info",
			Message:           msg,
			FollowUpQuestions: qs,
		}, nil
	case "layout_draft":
		// Validate version
		if raw.Version != 0 && raw.Version != model.LayoutDraftVersion {
			return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: fmt.Sprintf("unsupported layout version %d", raw.Version), HTTPStatus: 502}
		}
		if len(raw.Objects) == 0 {
			return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: "layout draft has no objects", HTTPStatus: 502}
		}
		if len(raw.Objects) > model.MaxLayoutObjects {
			return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: fmt.Sprintf("too many objects %d > %d", len(raw.Objects), model.MaxLayoutObjects), HTTPStatus: 502}
		}
		// Validate each object
		seenNames := map[string]int{}
		drafts := make([]model.LayoutObjectDraft, 0, len(raw.Objects))
		for i, o := range raw.Objects {
			kindStr := strings.TrimSpace(o.Kind)
			if !validKinds[kindStr] {
				return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: fmt.Sprintf("object %d has invalid kind %q", i, o.Kind), HTTPStatus: 502}
			}
			name := strings.TrimSpace(o.Name)
			if name == "" {
				name = fmt.Sprintf("%s %d", kindStr, i+1)
			}
			if len(name) > 100 {
				name = name[:100]
			}
			// Ensure unique names for display; not required but helpful
			if cnt, ok := seenNames[name]; ok {
				seenNames[name] = cnt + 1
				name = fmt.Sprintf("%s (%d)", name, cnt+1)
			} else {
				seenNames[name] = 1
			}
			if o.Width < 25.4 || o.Width > 10000 || !isFinite(o.Width) {
				return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: fmt.Sprintf("object %d width out of range", i), HTTPStatus: 502}
			}
			if o.Height < 25.4 || o.Height > 10000 || !isFinite(o.Height) {
				return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: fmt.Sprintf("object %d height out of range", i), HTTPStatus: 502}
			}
			if o.Depth < 25.4 || o.Depth > 10000 || !isFinite(o.Depth) {
				return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: fmt.Sprintf("object %d depth out of range", i), HTTPStatus: 502}
			}
			if !isFinite(o.X) || math.Abs(o.X) > 10000 {
				return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: fmt.Sprintf("object %d x out of range", i), HTTPStatus: 502}
			}
			if !isFinite(o.Y) || math.Abs(o.Y) > 10000 {
				return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: fmt.Sprintf("object %d y out of range", i), HTTPStatus: 502}
			}
			if !isFinite(o.Z) || math.Abs(o.Z) > 10000 {
				return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: fmt.Sprintf("object %d z out of range", i), HTTPStatus: 502}
			}
			if !isFinite(o.RotationDegrees) || math.Abs(o.RotationDegrees) > 360 {
				return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: fmt.Sprintf("object %d rotation out of range", i), HTTPStatus: 502}
			}
			// Round to 0.001 mm
			w := math.Round(o.Width*1000) / 1000
			h := math.Round(o.Height*1000) / 1000
			d := math.Round(o.Depth*1000) / 1000
			x := math.Round(o.X*1000) / 1000
			y := math.Round(o.Y*1000) / 1000
			z := math.Round(o.Z*1000) / 1000
			rot := math.Round(o.RotationDegrees*1000) / 1000
			drafts = append(drafts, model.LayoutObjectDraft{
				Kind:            model.ObjectKind(kindStr),
				Name:            name,
				DimensionsMm:    model.DimensionsMm{Width: w, Height: h, Depth: d},
				PositionMm:      model.PositionMm{X: x, Y: y, Z: z},
				RotationDegrees: rot,
			})
		}
		desc := strings.TrimSpace(raw.Description)
		if desc == "" {
			desc = "Draft based on photo — approximate positions along walls. Please verify measurements."
		}
		if len(desc) > 4000 {
			desc = desc[:4000]
		}
		qs := cleanQuestions(raw.FollowUpQuestions)
		if len(qs) == 0 {
			qs = []string{"What are the wall dimensions?", "Confirm cabinet heights and sink position?"}
		}
		warnings := []string{}
		for _, w := range raw.Warnings {
			t := strings.TrimSpace(w)
			if t == "" {
				continue
			}
			if len(t) > 500 {
				t = t[:500]
			}
			warnings = append(warnings, t)
			if len(warnings) >= 5 {
				break
			}
		}
		// Always ensure approximate warning present
		hasApproxWarning := false
		for _, w := range warnings {
			if strings.Contains(strings.ToLower(w), "approximate") {
				hasApproxWarning = true
				break
			}
		}
		if !hasApproxWarning {
			warnings = append([]string{"Approximate dimensions — please verify and measure before building."}, warnings...)
		}
		isApprox := true
		if raw.IsApproximate != nil {
			isApprox = *raw.IsApproximate
		}
		// Enforce approximate true for safety, even if model says false but dimensions are defaults.
		// Keep as provided but ensure warnings present.

		draft := &model.LayoutDraft{
			Version:           model.LayoutDraftVersion,
			Objects:           drafts,
			Description:       desc,
			FollowUpQuestions: qs,
			Warnings:          warnings,
			IsApproximate:     isApprox,
		}
		return model.LayoutDraftResponse{
			Kind:  "layout_draft",
			Draft: draft,
		}, nil
	default:
		return model.LayoutDraftResponse{}, &ServiceError{Code: "invalid_provider_response", Message: fmt.Sprintf("unknown layout kind %q", kind), HTTPStatus: 502}
	}
}

type ServiceError struct {
	Code       string
	Message    string
	HTTPStatus int
}

func (e *ServiceError) Error() string { return e.Code + ": " + e.Message }

func validate(req model.LayoutDraftRequest) *ServiceError {
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

func cleanQuestions(in []string) []string {
	out := []string{}
	for _, s := range in {
		t := strings.TrimSpace(s)
		if t == "" {
			continue
		}
		if len(t) > 300 {
			t = t[:300]
		}
		out = append(out, t)
		if len(out) >= 5 {
			break
		}
	}
	return out
}

func isFinite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func isTimeout(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "provider timeout") || strings.Contains(msg, "deadline") || strings.Contains(msg, "context deadline")
}

func isMissingAPIKey(err error) bool {
	return strings.Contains(err.Error(), "baseten api key not configured")
}

func isUnauthorized(err error) bool {
	return strings.Contains(err.Error(), "unauthorized")
}

func isModelUnavailable(err error) bool {
	return strings.Contains(err.Error(), "model_unavailable")
}

func isModelNotFound(err error) bool {
	return strings.Contains(err.Error(), "model_not_found")
}

func isRateLimited(err error) bool {
	return strings.Contains(err.Error(), "rate_limited")
}

func isInvalidProviderResponse(err error) bool {
	return strings.Contains(err.Error(), "invalid provider response")
}
